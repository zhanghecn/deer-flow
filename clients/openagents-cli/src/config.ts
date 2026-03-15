export interface ParsedFlags {
  server: string
  session?: string
  token?: string
  workspace?: string
  runtimeRoot?: string
  name?: string
  newSession: boolean
  json: boolean
}

export interface ParsedCommand {
  command: string[]
  flags: ParsedFlags
}

export function parseArgs(argv: string[]): ParsedCommand {
  const flags: ParsedFlags = {
    server: process.env.OPENAGENTS_REMOTE_SERVER || "http://127.0.0.1:2025",
    token: process.env.OPENAGENTS_REMOTE_SESSION_TOKEN,
    newSession: false,
    json: false,
  }
  const command: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith("--")) {
      command.push(token)
      continue
    }
    const next = argv[index + 1]
    switch (token) {
      case "--server":
        flags.server = next
        index += 1
        break
      case "--session":
        flags.session = next
        index += 1
        break
      case "--token":
        flags.token = next
        index += 1
        break
      case "--workspace":
        flags.workspace = next
        index += 1
        break
      case "--runtime-root":
        flags.runtimeRoot = next
        index += 1
        break
      case "--name":
        flags.name = next
        index += 1
        break
      case "--new":
        flags.newSession = true
        break
      case "--json":
        flags.json = true
        break
      default:
        throw new Error(`Unknown flag: ${token}`)
    }
  }

  return { command, flags }
}
