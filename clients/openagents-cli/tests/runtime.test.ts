import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { createPathMap } from "../src/path-map"
import { handleRequest } from "../src/runtime"
import type { RemoteRequestEnvelope } from "../src/types"

function makeRequest(operation: RemoteRequestEnvelope["operation"], payload: Record<string, unknown>): RemoteRequestEnvelope {
  return {
    request_id: "req-1",
    session_id: "session-1",
    operation,
    created_at: new Date().toISOString(),
    response_timeout_seconds: 5,
    payload,
  }
}

test("handleRequest writes and downloads files using virtual paths", async () => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "openagents-workspace-"))
  const runtimeRoot = mkdtempSync(path.join(os.tmpdir(), "openagents-runtime-"))
  const context = { pathMap: createPathMap(workspaceRoot, runtimeRoot) }

  try {
    const writeResponse = await handleRequest(
      makeRequest("write", {
        file_path: "/mnt/user-data/outputs/demo.txt",
        content: "hello",
      }),
      context,
    )
    expect(writeResponse.success).toBe(true)

    const downloadResponse = await handleRequest(
      makeRequest("download_files", {
        paths: ["/mnt/user-data/outputs/demo.txt"],
      }),
      context,
    )
    expect(downloadResponse.success).toBe(true)
    expect(Array.isArray(downloadResponse.payload.responses)).toBe(true)
    expect((downloadResponse.payload.responses as Array<Record<string, unknown>>)[0].content_b64).toBe("aGVsbG8=")
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true })
    rmSync(runtimeRoot, { recursive: true, force: true })
  }
})
