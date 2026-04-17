import { describe, expect, it } from "vitest";

import { coercePublicAPITurn, normalizeSDKResponseEvent } from "./sdk-compat";

describe("public api sdk compat", () => {
  it("normalizes sdk turn-event envelopes into the native public event budget", () => {
    const normalized = normalizeSDKResponseEvent({
      type: "tool.call.started",
      event: {
        type: "tool.call.started",
        sequence: 2,
        created_at: 12,
        turn_id: "turn_123",
        tool_name: "list_files",
      },
    });

    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({
      kind: "ledger_event",
      event: {
        type: "tool.call.started",
        tool_name: "list_files",
      },
    });
  });

  it("accepts retrieved turn snapshots", () => {
    expect(
      coercePublicAPITurn({
        id: "turn_123",
        status: "completed",
        object: "turn",
        created_at: 1,
        agent: "support-cases-agent",
        thread_id: "thread_123",
        output_text: "ok",
        reasoning_text: "",
        events: [],
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          total_tokens: 2,
        },
      }),
    ).toMatchObject({
      id: "turn_123",
      thread_id: "thread_123",
    });
  });

  it("rejects malformed retrieved payloads", () => {
    expect(coercePublicAPITurn({ status: "completed" })).toBeNull();
  });
});
