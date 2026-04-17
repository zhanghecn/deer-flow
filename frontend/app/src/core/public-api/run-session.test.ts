import { describe, expect, it } from "vitest";

import type { PublicAPITurnSnapshot } from "./api";
import {
  applyNormalizedPublicAPIRunEvent,
  applyPublicAPITurnSnapshot,
  createPublicAPIRunReadModel,
  extractPublicAPIReasoningSummary,
  formatPublicAPIOutputText,
} from "./run-session";

const traceText = {
  assistantMessage: "Assistant message",
  assistantThinking: "Assistant thinking",
  toolCall: "Tool call",
  toolResult: "Tool result",
  turnCompleted: "Turn completed",
  turnStarted: "Turn started",
  turnWaiting: "Turn waiting",
  turnFailed: "Turn failed",
};

describe("extractPublicAPIReasoningSummary", () => {
  it("returns native turn reasoning text", () => {
    const turn = {
      id: "turn_1",
      object: "turn",
      created_at: 1,
      status: "completed",
      agent: "demo-agent",
      thread_id: "thread-1",
      output_text: "done",
      reasoning_text: "First step\n\nSecond step",
      events: [],
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
      },
    } as PublicAPITurnSnapshot;

    expect(extractPublicAPIReasoningSummary(turn)).toBe(
      "First step\n\nSecond step",
    );
  });
});

describe("applyNormalizedPublicAPIRunEvent", () => {
  it("accumulates assistant deltas and unique ledger trace items", () => {
    const started = applyNormalizedPublicAPIRunEvent({
      current: createPublicAPIRunReadModel(),
      event: {
        kind: "turn_started",
        turnId: "turn_1",
        raw: {},
      },
      traceText,
    });
    const withDelta = applyNormalizedPublicAPIRunEvent({
      current: started,
      event: {
        kind: "assistant_text_delta",
        delta: "hello",
        raw: {},
      },
      traceText,
    });
    const withTool = applyNormalizedPublicAPIRunEvent({
      current: withDelta,
      event: {
        kind: "ledger_event",
        event: {
          sequence: 2,
          created_at: 2,
          type: "tool.call.started",
          turn_id: "turn_1",
          tool_name: "grep_files",
        },
        raw: {},
      },
      traceText,
    });
    const dedupedTool = applyNormalizedPublicAPIRunEvent({
      current: withTool,
      event: {
        kind: "ledger_event",
        event: {
          sequence: 2,
          created_at: 2,
          type: "tool.call.started",
          turn_id: "turn_1",
          tool_name: "grep_files",
        },
        raw: {},
      },
      traceText,
    });

    expect(dedupedTool.turnId).toBe("turn_1");
    expect(dedupedTool.liveOutput).toBe("hello");
    expect(dedupedTool.traceItems).toHaveLength(2);
    expect(dedupedTool.traceItems[0]).toMatchObject({
      stage: "assistant",
      tone: "assistant",
      detail: "hello",
    });
    expect(dedupedTool.toolCallCount).toBe(1);
  });

  it("accumulates reasoning deltas into one visible stream", () => {
    const next = applyNormalizedPublicAPIRunEvent({
      current: createPublicAPIRunReadModel(),
      event: {
        kind: "assistant_reasoning_delta",
        delta: "thinking...",
        raw: {},
      },
      traceText,
    });

    expect(next.liveReasoning).toBe("thinking...");
    expect(next.traceItems[0]).toMatchObject({
      title: "Assistant thinking",
      detail: "thinking...",
    });
  });
});

describe("applyPublicAPITurnSnapshot", () => {
  it("hydrates the final turn without duplicating seen events", () => {
    const current = applyNormalizedPublicAPIRunEvent({
      current: createPublicAPIRunReadModel(),
      event: {
        kind: "ledger_event",
        event: {
          sequence: 1,
          created_at: 1,
          type: "tool.call.started",
          turn_id: "turn_2",
          tool_name: "list_files",
        },
        raw: {},
      },
      traceText,
    });

    const hydrated = applyPublicAPITurnSnapshot({
      current,
      turn: {
        id: "turn_2",
        object: "turn",
        created_at: 2,
        status: "completed",
        agent: "demo-agent",
        thread_id: "thread-1",
        output_text: "done",
        reasoning_text: "Projected summary",
        events: [
          {
            sequence: 1,
            created_at: 1,
            type: "tool.call.started",
            turn_id: "turn_2",
            tool_name: "list_files",
          },
          {
            sequence: 2,
            created_at: 2,
            type: "turn.completed",
            turn_id: "turn_2",
            text: "done",
            reasoning: "Projected summary",
          },
        ],
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          total_tokens: 2,
        },
      },
      traceText,
    });

    expect(hydrated.traceItems).toHaveLength(2);
    expect(hydrated.toolCallCount).toBe(1);
    expect(hydrated.liveReasoning).toBe("Projected summary");
    expect(hydrated.liveOutput).toBe("done");
    expect(hydrated.phase).toBe("ready");
  });
});

describe("formatPublicAPIOutputText", () => {
  it("pretty-prints JSON output text", () => {
    expect(
      formatPublicAPIOutputText(
        {
          id: "turn_3",
          object: "turn",
          created_at: 3,
          status: "completed",
          agent: "demo-agent",
          thread_id: "thread-1",
          output_text: '{"ok":true}',
          reasoning_text: "",
          events: [],
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            total_tokens: 2,
          },
        } as PublicAPITurnSnapshot,
        "",
      ),
    ).toBe('{\n  "ok": true\n}');
  });
});
