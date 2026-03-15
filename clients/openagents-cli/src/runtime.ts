import { Buffer } from "node:buffer"

import {
  downloadFiles,
  editFile,
  globInfo,
  grepRaw,
  lsInfo,
  readWithPagination,
  uploadFiles,
  writeNewFile,
} from "./files"
import { error, info } from "./logger"
import { executeCommand } from "./shell"
import type { RemoteRequestEnvelope, RuntimeContext, SubmitRemoteResponseRequest } from "./types"

function ok(payload: Record<string, unknown>): SubmitRemoteResponseRequest {
  return { success: true, payload }
}

function fail(err: unknown): SubmitRemoteResponseRequest {
  return {
    success: false,
    payload: {},
    error: err instanceof Error ? err.message : String(err),
  }
}

export async function handleRequest(
  request: RemoteRequestEnvelope,
  context: RuntimeContext,
): Promise<SubmitRemoteResponseRequest> {
  try {
    switch (request.operation) {
      case "execute":
        return ok(
          await executeCommand(
            String(request.payload.command ?? ""),
            context.pathMap,
            Number(request.payload.timeout ?? request.response_timeout_seconds ?? 120),
          ),
        )
      case "ls_info":
        return ok({ entries: await lsInfo(String(request.payload.path ?? "/mnt/user-data/workspace"), context.pathMap) })
      case "read":
        return ok({
          content: await readWithPagination(
            String(request.payload.file_path ?? ""),
            Number(request.payload.offset ?? 0),
            Number(request.payload.limit ?? 2000),
            context.pathMap,
          ),
        })
      case "grep_raw":
        return ok({
          matches: await grepRaw(
            String(request.payload.pattern ?? ""),
            request.payload.path ? String(request.payload.path) : undefined,
            request.payload.glob ? String(request.payload.glob) : undefined,
            context.pathMap,
          ),
        })
      case "glob_info":
        return ok({
          entries: await globInfo(
            String(request.payload.pattern ?? ""),
            String(request.payload.path ?? "/mnt/user-data/workspace"),
            context.pathMap,
          ),
        })
      case "write":
        return ok(
          await writeNewFile(
            String(request.payload.file_path ?? ""),
            String(request.payload.content ?? ""),
            context.pathMap,
          ),
        )
      case "edit":
        return ok(
          await editFile(
            String(request.payload.file_path ?? ""),
            String(request.payload.old_string ?? ""),
            String(request.payload.new_string ?? ""),
            Boolean(request.payload.replace_all),
            context.pathMap,
          ),
        )
      case "upload_files":
        return ok({
          responses: await uploadFiles(
            (Array.isArray(request.payload.files) ? request.payload.files : []).map((item) => ({
              path: String((item as Record<string, unknown>).path ?? ""),
              content: new Uint8Array(Buffer.from(String((item as Record<string, unknown>).content_b64 ?? ""), "base64")),
            })),
            context.pathMap,
          ),
        })
      case "download_files":
        return ok({
          responses: (
            await downloadFiles(
              Array.isArray(request.payload.paths) ? request.payload.paths.map((item) => String(item)) : [],
              context.pathMap,
            )
          ).map((item) => ({
            path: item.path,
            content_b64: item.content ? Buffer.from(item.content).toString("base64") : undefined,
            error: item.error,
          })),
        })
      default:
        return fail(`Unsupported operation: ${request.operation}`)
    }
  } catch (err) {
    return fail(err)
  }
}

export async function runWorker(
  client: {
    heartbeat: (status?: "connected" | "disconnected") => Promise<void>
    pollRequest: (waitSeconds?: number) => Promise<RemoteRequestEnvelope | null>
    submitResponse: (requestId: string, payload: SubmitRemoteResponseRequest) => Promise<void>
  },
  context: RuntimeContext,
  shouldStop: () => boolean,
): Promise<void> {
  const timer = setInterval(() => {
    void client.heartbeat("connected").catch((err) => error(`heartbeat failed: ${err}`))
  }, 10_000)

  try {
    while (!shouldStop()) {
      const request = await client.pollRequest(20)
      if (!request) continue
      info(`handling ${request.operation} (${request.request_id})`)
      const response = await handleRequest(request, context)
      await client.submitResponse(request.request_id, response)
    }
  } finally {
    clearInterval(timer)
    await client.heartbeat("disconnected").catch(() => {})
  }
}
