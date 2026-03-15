import os from "node:os"
import readline from "node:readline/promises"

import { parseArgs } from "./config"
import { info } from "./logger"
import { createPathMap } from "./path-map"
import { RemoteRelayClient } from "./protocol"
import { handleRequest, runWorker } from "./runtime"
import { ensureRuntimeRoot, resolveRuntimeRoot, resolveWorkspaceRoot } from "./session"

function printHelp(): void {
  console.log(`openagents-cli

Commands:
  openagents-cli doctor [--server URL]
  openagents-cli sessions [--server URL]
  openagents-cli session create [--server URL] [--name NAME] [--json]
  openagents-cli connect [--server URL] [--session ID] [--token TOKEN] [--workspace DIR] [--runtime-root DIR] [--name NAME] [--new]

Interactive mode:
  /sessions
  /agents        alias of /sessions
  /new
  /connect <session_id> <token>
  /doctor
  /exit
`)
}

async function connectWorker(flags: ReturnType<typeof parseArgs>["flags"]): Promise<void> {
  const client = new RemoteRelayClient(flags.server, flags.session, flags.token)
  const name = flags.name || os.hostname()

  if (flags.newSession) {
    const created = await client.registerSession({
      client_name: name,
      cli_version: "0.1.0",
      platform: process.platform,
      hostname: os.hostname(),
    })
    client.setSession(created.session_id, created.client_token)
    flags.session = created.session_id
    flags.token = created.client_token
    console.log(JSON.stringify(created, null, 2))
  }

  if (!flags.session || !flags.token) {
    throw new Error("connect requires --session and --token, or use --new")
  }

  const workspaceRoot = resolveWorkspaceRoot(flags.workspace)
  const runtimeRoot = resolveRuntimeRoot(flags.session, flags.runtimeRoot)
  ensureRuntimeRoot(runtimeRoot)
  const pathMap = createPathMap(workspaceRoot, runtimeRoot)

  await client.connectSession({
    workspace_root: workspaceRoot,
    runtime_root: runtimeRoot,
    client_name: name,
    cli_version: "0.1.0",
    platform: process.platform,
    hostname: os.hostname(),
  })

  info(`connected session ${flags.session}`)
  info(`workspace: ${workspaceRoot}`)
  info(`runtime:   ${runtimeRoot}`)

  let stop = false
  const stopWorker = () => {
    stop = true
  }
  process.on("SIGINT", stopWorker)
  process.on("SIGTERM", stopWorker)

  try {
    await runWorker(client, { pathMap }, () => stop)
  } finally {
    process.off("SIGINT", stopWorker)
    process.off("SIGTERM", stopWorker)
  }
}

async function runInteractive(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    printHelp()
    while (true) {
      const raw = (await rl.question("openagents-cli> ")).trim()
      if (!raw) continue
      if (raw === "/exit") return
      if (raw === "/help") {
        printHelp()
        continue
      }

      const args = raw
        .replace(/^\//, "")
        .split(/\s+/)
        .filter(Boolean)
      if (args[0] === "agents") args[0] = "sessions"
      await runCommand(args)
    }
  } finally {
    rl.close()
  }
}

export async function runCommand(argv = Bun.argv.slice(2)): Promise<void> {
  const { command, flags } = parseArgs(argv)
  if (command.length === 0) {
    await runInteractive()
    return
  }

  const client = new RemoteRelayClient(flags.server, flags.session, flags.token)
  if (command[0] === "doctor") {
    await client.health()
    info(`relay healthy at ${flags.server}`)
    return
  }

  if (command[0] === "sessions") {
    const sessions = await client.listSessions()
    console.log(JSON.stringify(sessions, null, 2))
    return
  }

  if (command[0] === "session" && command[1] === "create") {
    const created = await client.registerSession({
      client_name: flags.name || os.hostname(),
      cli_version: "0.1.0",
      platform: process.platform,
      hostname: os.hostname(),
    })
    if (flags.json) {
      console.log(JSON.stringify(created, null, 2))
      return
    }
    info(`session_id: ${created.session_id}`)
    info(`token:      ${created.client_token}`)
    return
  }

  if (command[0] === "connect") {
    await connectWorker(flags)
    return
  }

  printHelp()
  throw new Error(`Unknown command: ${command.join(" ")}`)
}
