import path from "node:path"

import type { PathMap } from "./types"

const VIRTUAL_ROOT = "/mnt/user-data"

const SHORTHAND_PREFIXES = {
  workspace: "/workspace",
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
    [`${VIRTUAL_ROOT}/uploads`, map.uploadsRoot],
    [`${VIRTUAL_ROOT}/outputs`, map.outputsRoot],
    [`${VIRTUAL_ROOT}/agents`, map.agentsRoot],
    [`${VIRTUAL_ROOT}/authoring`, map.authoringRoot],
    [SHORTHAND_PREFIXES.workspace, map.workspaceRoot],
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
  let rewritten = command
  const replacements: Array<[string, string]> = [
    [`${VIRTUAL_ROOT}/workspace`, map.workspaceRoot],
    [`${VIRTUAL_ROOT}/uploads`, map.uploadsRoot],
    [`${VIRTUAL_ROOT}/outputs`, map.outputsRoot],
    [`${VIRTUAL_ROOT}/agents`, map.agentsRoot],
    [`${VIRTUAL_ROOT}/authoring`, map.authoringRoot],
    [SHORTHAND_PREFIXES.workspace, map.workspaceRoot],
    [SHORTHAND_PREFIXES.uploads, map.uploadsRoot],
    [SHORTHAND_PREFIXES.outputs, map.outputsRoot],
    [SHORTHAND_PREFIXES.agents, map.agentsRoot],
    [SHORTHAND_PREFIXES.authoring, map.authoringRoot],
    [VIRTUAL_ROOT, map.userDataRoot],
  ]

  for (const [virtualPath, actualPath] of replacements.sort((a, b) => b[0].length - a[0].length)) {
    const pattern = new RegExp(`(?<![A-Za-z0-9_./-])${escapeRegExp(virtualPath)}(?=(/|\\\\b))`, "g")
    rewritten = rewritten.replace(pattern, actualPath)
  }

  return rewritten
}

export function toVirtualPath(actualPath: string, map: PathMap): string | null {
  const resolved = path.resolve(actualPath)
  const routes: Array<[string, string]> = [
    [map.workspaceRoot, `${VIRTUAL_ROOT}/workspace`],
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
