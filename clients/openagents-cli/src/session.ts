import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

export function resolveWorkspaceRoot(input?: string): string {
  return path.resolve(input ?? process.cwd())
}

export function resolveRuntimeRoot(sessionId: string, explicitRoot?: string): string {
  if (explicitRoot) return path.resolve(explicitRoot)
  return path.resolve(homedir(), ".openagents-cli", "sessions", sessionId)
}

export function ensureRuntimeRoot(runtimeRoot: string): void {
  mkdirSync(runtimeRoot, { recursive: true })
  mkdirSync(path.join(runtimeRoot, "uploads"), { recursive: true })
  mkdirSync(path.join(runtimeRoot, "outputs"), { recursive: true })
  mkdirSync(path.join(runtimeRoot, "agents"), { recursive: true })
}
