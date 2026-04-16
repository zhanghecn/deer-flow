import { describe, expect, it } from "vitest";

import { coercePublicAPIResponse, normalizeSDKResponseEvent } from "./sdk-compat";

describe("public api sdk compat", () => {
  it("normalizes sdk run-event envelopes into the canonical public event budget", () => {
    const normalized = normalizeSDKResponseEvent({
      type: "response.run_event",
      event: {
        type: "tool_started",
        event_index: 2,
        created_at: 12,
        response_id: "resp_123",
        tool_name: "list_files",
      },
    });

    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({
      kind: "ledger_event",
      event: {
        type: "tool_started",
        tool_name: "list_files",
      },
    });
  });

  it("accepts retrieved response envelopes that include openagents extensions", () => {
    expect(
      coercePublicAPIResponse({
        id: "resp_123",
        status: "completed",
        object: "response",
        created_at: 1,
        model: "support-cases-agent",
        output_text: "ok",
        openagents: {
          thread_id: "thread_123",
        },
      }),
    ).toMatchObject({
      id: "resp_123",
      openagents: {
        thread_id: "thread_123",
      },
    });
  });

  it("rejects malformed retrieved payloads", () => {
    expect(coercePublicAPIResponse({ status: "completed" })).toBeNull();
  });
});
