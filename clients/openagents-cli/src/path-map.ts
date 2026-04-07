import path from "node:path"

import type { PathMap } from "./types"

const VIRTUAL_ROOT = "/mnt/user-data"

const SHORTHAND_PREFIXES = {
  workspace: "/workspace",
  tmp: "/tmp",
  uploads: "/uploads",
  outputs: "/outputs",
  agents: "/agents",
  authoring: "/authoring",
} as const

function normalizeVirtualTail(tail: string): string {
  const parts = tail.split("/").filter(Boolean)
  if (parts.some((part) => part === "..")) {
    throw new Error(`Invalid virtual path: ${tail}`)
  }
  return parts.join("/")
}

function mapKnownPrefix(input: string, map: PathMap): string | null {
  const routes: Array<[string, string]> = [
    [`${VIRTUAL_ROOT}/workspace`, map.workspaceRoot],
    [`${VIRTUAL_ROOT}/tmp`, map.tmpRoot],
    [`${VIRTUAL_ROOT}/uploads`, map.uploadsRoot],
    [`${VIRTUAL_ROOT}/outputs`, map.outputsRoot],
    [`${VIRTUAL_ROOT}/agents`, map.agentsRoot],
    [`${VIRTUAL_ROOT}/authoring`, map.authoringRoot],
    [SHORTHAND_PREFIXES.workspace, map.workspaceRoot],
    [SHORTHAND_PREFIXES.tmp, map.tmpRoot],
    [SHORTHAND_PREFIXES.uploads, map.uploadsRoot],
    [SHORTHAND_PREFIXES.outputs, map.outputsRoot],
    [SHORTHAND_PREFIXES.agents, map.agentsRoot],
    [SHORTHAND_PREFIXES.authoring, map.authoringRoot],
    [VIRTUAL_ROOT, map.userDataRoot],
  ]

  for (const [prefix, target] of routes) {
    if (input === prefix) return target
    if (!input.startsWith(`${prefix}/`)) continue
    const tail = normalizeVirtualTail(input.slice(prefix.length))
    return path.resolve(target, `.${path.sep}${tail}`)
  }
  return null
}

export function createPathMap(workspaceRoot: string, runtimeRoot: string): PathMap {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot)
  const resolvedRuntimeRoot = path.resolve(runtimeRoot)
  return {
    workspaceRoot: resolvedWorkspaceRoot,
    runtimeRoot: resolvedRuntimeRoot,
    tmpRoot: path.join(resolvedRuntimeRoot, "tmp"),
    uploadsRoot: path.join(resolvedRuntimeRoot, "uploads"),
    outputsRoot: path.join(resolvedRuntimeRoot, "outputs"),
    agentsRoot: path.join(resolvedRuntimeRoot, "agents"),
    authoringRoot: path.join(resolvedRuntimeRoot, "authoring"),
    userDataRoot: resolvedRuntimeRoot,
  }
}

export function rewriteVirtualPath(input: string, map: PathMap): string {
  const mapped = mapKnownPrefix(input, map)
  if (mapped) return mapped
  if (path.isAbsolute(input)) return path.resolve(input)
  return path.resolve(map.workspaceRoot, input)
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function rewriteVirtualPathsInCommand(command: string, map: PathMap): string {
  const replacements: Array<[string, string]> = [
    [`${VIRTUAL_ROOT}/workspace`, map.workspaceRoot],
    [`${VIRTUAL_ROOT}/tmp`, map.tmpRoot],
    [`${VIRTUAL_ROOT}/uploads`, map.uploadsRoot],
    [`${VIRTUAL_ROOT}/outputs`, map.outputsRoot],
    [`${VIRTUAL_ROOT}/agents`, map.agentsRoot],
    [`${VIRTUAL_ROOT}/authoring`, map.authoringRoot],
    [SHORTHAND_PREFIXES.workspace, map.workspaceRoot],
    [SHORTHAND_PREFIXES.tmp, map.tmpRoot],
    [SHORTHAND_PREFIXES.uploads, map.uploadsRoot],
    [SHORTHAND_PREFIXES.outputs, map.outputsRoot],
    [SHORTHAND_PREFIXES.agents, map.agentsRoot],
    [SHORTHAND_PREFIXES.authoring, map.authoringRoot],
    [VIRTUAL_ROOT, map.userDataRoot],
  ]

  const orderedReplacements = replacements.sort((a, b) => b[0].length - a[0].length)
  const alternation = orderedReplacements.map(([virtualPath]) => escapeRegExp(virtualPath)).join("|")

  // Replace from the original command text once so `/tmp` does not re-match
  // already-expanded host paths like `/tmp/openagents-runtime/.../agents/...`.
  const pattern = new RegExp(`(?<![A-Za-z0-9_./-])(${alternation})(?=(/|\\b))`, "g")
  return command.replace(pattern, (match) => {
    const replacement = orderedReplacements.find(([virtualPath]) => virtualPath === match)
    return replacement?.[1] ?? match
  })
}

export function toVirtualPath(actualPath: string, map: PathMap): string | null {
  const resolved = path.resolve(actualPath)
  const routes: Array<[string, string]> = [
    [map.workspaceRoot, `${VIRTUAL_ROOT}/workspace`],
    [map.tmpRoot, `${VIRTUAL_ROOT}/tmp`],
    [map.uploadsRoot, `${VIRTUAL_ROOT}/uploads`],
    [map.outputsRoot, `${VIRTUAL_ROOT}/outputs`],
    [map.agentsRoot, `${VIRTUAL_ROOT}/agents`],
    [map.authoringRoot, `${VIRTUAL_ROOT}/authoring`],
    [map.userDataRoot, VIRTUAL_ROOT],
  ]

  for (const [root, virtualRoot] of routes) {
    const relative = path.relative(root, resolved)
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue
    const normalized = relative.split(path.sep).join("/")
    return normalized.length ? `${virtualRoot}/${normalized}` : virtualRoot
  }

  return null
}
