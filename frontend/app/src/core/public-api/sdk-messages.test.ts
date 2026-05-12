import { describe, expect, it, vi } from "vitest";

import type { PublicAPITurnSnapshot } from "./api";
import { createPublicAPIRunReadModel } from "./run-session";
import { createPublicAPISDKMessageProjector } from "./sdk-messages";

describe("createPublicAPISDKMessageProjector", () => {
  it("projects tool and final turn events into SDK messages", () => {
    const onMessage = vi.fn();
    const projector = createPublicAPISDKMessageProjector({
      agent: "demo-agent",
      sessionId: "session-1",
      includePartialMessages: true,
      onMessage,
    });

    const readModel = {
      ...createPublicAPIRunReadModel(),
      turnId: "turn-1",
      liveOutput: "done",
    };

    projector.consume({
      event: {
        kind: "ledger_event",
        raw: {},
        event: {
          sequence: 1,
          created_at: 1,
          type: "tool.call.started",
          turn_id: "turn-1",
          tool_call_id: "call-1",
          tool_name: "search",
          tool_arguments: { query: "case" },
        },
      },
      readModel,
    });

    projector.consume({
      event: {
        kind: "ledger_event",
        raw: {},
        event: {
          sequence: 2,
          created_at: 2,
          type: "tool.call.completed",
          turn_id: "turn-1",
          tool_call_id: "call-1",
          tool_name: "search",
          tool_output: [{ type: "text", text: "ok" }],
        },
      },
      readModel,
    });

    projector.finalizeTurn(
      {
        id: "turn-1",
        object: "turn",
        status: "completed",
        agent: "demo-agent",
        thread_id: "thread-1",
        output_text: "done",
        reasoning_text: "looked up the case",
        usage: {
          input_tokens: 1,
          output_tokens: 2,
          total_tokens: 3,
        },
        events: [],
        created_at: 1,
      } as PublicAPITurnSnapshot,
      readModel,
    );

    expect(projector.messages.map((message) => message.type)).toEqual([
      "system",
      "stream_event",
      "tool_call",
      "stream_event",
      "tool_result",
      "assistant",
      "result",
    ]);
    expect(
      projector.messages.find((message) => message.type === "tool_call"),
    ).toMatchObject({
      tool_call_id: "call-1",
      tool_name: "search",
      tool_arguments: { query: "case" },
    });
    expect(projector.messages.at(-1)).toMatchObject({
      type: "result",
      subtype: "success",
      output_text: "done",
    });
    expect(onMessage).toHaveBeenCalledTimes(projector.messages.length);
  });

  it("emits one error result for failed turns", () => {
    const projector = createPublicAPISDKMessageProjector({
      agent: "demo-agent",
      sessionId: "session-1",
    });
    const readModel = {
      ...createPublicAPIRunReadModel(),
      turnId: "turn-failed",
      phase: "failed" as const,
    };

    projector.consume({
      event: {
        kind: "ledger_event",
        raw: {},
        event: {
          sequence: 1,
          created_at: 1,
          type: "turn.failed",
          turn_id: "turn-failed",
          error: "model not found",
        },
      },
      readModel,
    });
    projector.finalizeTurn(null, readModel);

    expect(
      projector.messages.filter((message) => message.type === "result"),
    ).toHaveLength(1);
    expect(projector.messages.at(-1)).toMatchObject({
      type: "result",
      subtype: "error",
      error: "model not found",
    });
  });

  it("does not turn failed snapshots without events into success results", () => {
    const projector = createPublicAPISDKMessageProjector({
      agent: "demo-agent",
      sessionId: "session-1",
    });
    const readModel = {
      ...createPublicAPIRunReadModel(),
      turnId: "turn-failed",
      phase: "failed" as const,
    };

    projector.finalizeTurn(
      {
        id: "turn-failed",
        object: "turn",
        status: "failed",
        agent: "demo-agent",
        thread_id: "thread-1",
        output_text: "",
        reasoning_text: "",
        usage: {
          input_tokens: 1,
          output_tokens: 0,
          total_tokens: 1,
        },
        events: [],
        created_at: 1,
        completed_at: 2,
      } as PublicAPITurnSnapshot,
      readModel,
    );

    expect(projector.messages.at(-1)).toMatchObject({
      type: "result",
      subtype: "error",
      error: "Turn failed",
    });
  });
});
