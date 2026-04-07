import { createPathMap, rewriteVirtualPathsInCommand } from "./path-map"
import type { PathMap } from "./types"

function shellCommand(command: string): string[] {
  if (process.platform === "win32") {
    const comspec = process.env.ComSpec || "cmd.exe"
    return [comspec, "/d", "/s", "/c", command]
  }
  const shell = process.env.SHELL || "bash"
  return [shell, "-lc", command]
}

export async function executeCommand(
  command: string,
  map: PathMap,
  timeoutSeconds: number,
): Promise<{ output: string; exit_code: number | null; truncated: boolean }> {
  const rewritten = rewriteVirtualPathsInCommand(command, map)
  const proc = Bun.spawn({
    cmd: shellCommand(rewritten),
    cwd: map.workspaceRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      OPENAGENTS_WORKSPACE: map.workspaceRoot,
      OPENAGENTS_TMP: map.tmpRoot,
      OPENAGENTS_UPLOADS: map.uploadsRoot,
      OPENAGENTS_OUTPUTS: map.outputsRoot,
      OPENAGENTS_AGENTS: map.agentsRoot,
      OPENAGENTS_RUNTIME_ROOT: map.runtimeRoot,
      TMPDIR: map.tmpRoot,
      TMP: map.tmpRoot,
      TEMP: map.tmpRoot,
    },
  })

  const timeout = setTimeout(() => {
    try {
      proc.kill()
    } catch {}
  }, Math.max(timeoutSeconds, 1) * 1000)

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  clearTimeout(timeout)

  const outputParts = []
  if (stdout) outputParts.push(stdout)
  if (stderr) {
    outputParts.push(
      ...stderr
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => `[stderr] ${line}`),
    )
  }
  let output = outputParts.length ? outputParts.join("\n") : "<no output>"
  let truncated = false
  if (output.length > 100_000) {
    output = `${output.slice(0, 100_000)}\n\n... Output truncated at 100000 bytes.`
    truncated = true
  }
  if (exitCode !== 0) {
    output = `${output.replace(/\s+$/, "")}\n\nExit code: ${exitCode}`
  }
  return { output, exit_code: exitCode, truncated }
}
