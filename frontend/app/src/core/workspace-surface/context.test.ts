import { describe, expect, it } from "vitest";

import { isDesignBridgePayloadForActiveSession } from "./context";

const activeSession = {
  access_token: "token-1",
  thread_id: "thread-7",
  session_id: "session-9",
  session_generation: 3,
  target_path: "/mnt/user-data/outputs/designs/canvas.op",
  revision: "rev-5",
  relative_url: "/openpencil/editor",
  expires_at: "2026-04-13T00:00:00Z",
} as const;

describe("isDesignBridgePayloadForActiveSession", () => {
  it("rejects stale bridge payloads when the session tuple does not match", () => {
    expect(
      isDesignBridgePayloadForActiveSession(
        {
          threadId: "thread-7",
          sessionId: "session-8",
          sessionGeneration: 2,
        },
        activeSession,
      ),
    ).toBe(false);
  });

  it("accepts legacy payloads that do not carry the identity tuple yet", () => {
    expect(
      isDesignBridgePayloadForActiveSession(
        {
          targetPath: activeSession.target_path,
        },
        activeSession,
      ),
    ).toBe(true);
  });

  it("rejects legacy payloads when their target path does not match", () => {
    expect(
      isDesignBridgePayloadForActiveSession(
        {
          targetPath: "/mnt/user-data/outputs/designs/other.op",
        },
        activeSession,
      ),
    ).toBe(false);
  });

  it("rejects bridge payloads when no active design session is bound", () => {
    expect(
      isDesignBridgePayloadForActiveSession(
        {
          targetPath: activeSession.target_path,
        },
        null,
      ),
    ).toBe(false);
  });
});
