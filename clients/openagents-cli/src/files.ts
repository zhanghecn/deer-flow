import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"

import { rewriteVirtualPath, toVirtualPath } from "./path-map"
import type { PathMap } from "./types"

async function safeStat(input: string) {
  try {
    return await stat(input)
  } catch {
    return null
  }
}

async function walkFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(root, entry.name)
      if (entry.isDirectory()) return walkFiles(fullPath)
      if (entry.isFile()) return [fullPath]
      return []
    }),
  )
  return nested.flat()
}

function paginationFooter(start: number, end: number, total: number): string {
  if (total === 0) return "(Showing 0 lines.)"
  if (end >= total) return `(End of file - total ${total} lines)`
  return `(Showing lines ${start + 1}-${end} of ${total}. ${total - end} lines remaining. Use offset=${end} to continue.)`
}

export async function lsInfo(pathname: string, map: PathMap) {
  const resolved = rewriteVirtualPath(pathname, map)
  const directoryEntries = await readdir(resolved, { withFileTypes: true }).catch(() => [])
  const results = await Promise.all(
    directoryEntries.map(async (entry) => {
      const fullPath = path.join(resolved, entry.name)
      const details = await safeStat(fullPath)
      const virtualPath = toVirtualPath(fullPath, map) ?? fullPath
      if (!details) {
        return { path: entry.isDirectory() ? `${virtualPath}/` : virtualPath, is_dir: entry.isDirectory() }
      }
      return {
        path: entry.isDirectory() ? `${virtualPath}/` : virtualPath,
        is_dir: entry.isDirectory(),
        size: entry.isDirectory() ? 0 : details.size,
        modified_at: details.mtime.toISOString(),
      }
    }),
  )
  return results.sort((a, b) => String(a.path).localeCompare(String(b.path)))
}

export async function readWithPagination(filePath: string, offset: number, limit: number, map: PathMap): Promise<string> {
  const resolved = rewriteVirtualPath(filePath, map)
  const content = await Bun.file(resolved).text().catch(() => null)
  if (content === null) return `Error: File '${filePath}' not found`
  if (!content.trim()) return "System reminder: File exists but has empty contents"

  const lines = content.split(/\r?\n/)
  if (offset >= lines.length) return `Error: Line offset ${offset} exceeds file length (${lines.length} lines)`
  const end = Math.min(offset + limit, lines.length)
  const selected = lines.slice(offset, end)
  const body = selected.map((line, index) => `${String(offset + index + 1).padStart(6, " ")}\t${line}`).join("\n")
  return `${body}\n\n${paginationFooter(offset, end, lines.length)}`
}

export async function writeNewFile(filePath: string, content: string, map: PathMap) {
  const resolved = rewriteVirtualPath(filePath, map)
  const exists = await safeStat(resolved)
  if (exists) {
    return {
      error:
        `Cannot write to ${filePath} because it already exists. Read it and use edit_file to modify the existing file, or write to a new path.`,
    }
  }
  await mkdir(path.dirname(resolved), { recursive: true })
  await writeFile(resolved, content, "utf8")
  return { path: filePath }
}

export async function editFile(
  filePath: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
  map: PathMap,
) {
  const resolved = rewriteVirtualPath(filePath, map)
  const content = await Bun.file(resolved).text().catch(() => null)
  if (content === null) return { error: `Error: File '${filePath}' not found` }

  const occurrences = content.split(oldString).length - 1
  if (occurrences === 0) return { error: `Error: String not found in file: '${oldString}'` }
  if (occurrences > 1 && !replaceAll) {
    return { error: `Error: String '${oldString}' appears multiple times. Use replace_all=true to replace all occurrences.` }
  }

  const next = replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString)
  await writeFile(resolved, next, "utf8")
  return { path: filePath, occurrences }
}

export async function grepRaw(pattern: string, basePath: string | null | undefined, glob: string | null | undefined, map: PathMap) {
  const resolvedRoot = rewriteVirtualPath(basePath || "/mnt/user-data/workspace", map)
  const files = await walkFiles(resolvedRoot).catch(() => [])
  const globMatcher = glob ? new Bun.Glob(glob) : null
  const matches: Array<{ path: string; line: number; text: string }> = []

  for (const filePath of files) {
    if (globMatcher) {
      const relative = path.relative(resolvedRoot, filePath).split(path.sep).join("/")
      let matched = false
      for await (const _ of globMatcher.scan({ cwd: resolvedRoot, absolute: false, onlyFiles: true })) {
        if (_ === relative) {
          matched = true
          break
        }
      }
      if (!matched) continue
    }

    const content = await Bun.file(filePath).text().catch(() => null)
    if (content === null) continue
    content.split(/\r?\n/).forEach((line, index) => {
      if (!line.includes(pattern)) return
      matches.push({
        path: toVirtualPath(filePath, map) ?? filePath,
        line: index + 1,
        text: line,
      })
    })
  }

  return matches
}

export async function globInfo(pattern: string, basePath: string, map: PathMap) {
  const resolvedRoot = rewriteVirtualPath(basePath, map)
  const matcher = new Bun.Glob(pattern.replace(/^\//, ""))
  const results: Array<{ path: string; is_dir: boolean; size?: number; modified_at?: string }> = []
  for await (const relativePath of matcher.scan({ cwd: resolvedRoot, absolute: false, onlyFiles: true })) {
    const fullPath = path.join(resolvedRoot, relativePath)
    const details = await safeStat(fullPath)
    results.push({
      path: toVirtualPath(fullPath, map) ?? fullPath,
      is_dir: false,
      size: details?.size,
      modified_at: details?.mtime.toISOString(),
    })
  }
  return results.sort((a, b) => String(a.path).localeCompare(String(b.path)))
}

export async function uploadFiles(
  files: Array<{ path: string; content: Uint8Array }>,
  map: PathMap,
) {
  const responses: Array<{ path: string; error: string | null }> = []
  for (const item of files) {
    const resolved = rewriteVirtualPath(item.path, map)
    await mkdir(path.dirname(resolved), { recursive: true })
    await Bun.write(resolved, item.content)
    responses.push({ path: item.path, error: null })
  }
  return responses
}

export async function downloadFiles(paths: string[], map: PathMap) {
  const responses: Array<{ path: string; content?: Uint8Array; error: string | null }> = []
  for (const item of paths) {
    const resolved = rewriteVirtualPath(item, map)
    const details = await safeStat(resolved)
    if (!details) {
      responses.push({ path: item, error: "file_not_found" })
      continue
    }
    if (details.isDirectory()) {
      responses.push({ path: item, error: "is_directory" })
      continue
    }
    const content = new Uint8Array(await readFile(resolved))
    responses.push({ path: item, content, error: null })
  }
  return responses
}
