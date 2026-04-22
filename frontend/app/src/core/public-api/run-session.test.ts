import { describe, expect, it } from "vitest";

import type { PublicAPITurnSnapshot } from "./api";
import {
  applyNormalizedPublicAPIRunEvent,
  applyPublicAPITurnSnapshot,
  createPublicAPIRunReadModel,
  extractPublicAPIReasoningSummary,
  formatPublicAPIOutputText,
  mergeStreamingText,
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

  it("preserves streamed reasoning whitespace instead of trimming it away", () => {
    const first = applyNormalizedPublicAPIRunEvent({
      current: createPublicAPIRunReadModel(),
      event: {
        kind: "assistant_reasoning_delta",
        delta: "First line\n",
        raw: {},
      },
      traceText,
    });

    const second = applyNormalizedPublicAPIRunEvent({
      current: first,
      event: {
        kind: "assistant_reasoning_delta",
        delta: "\nSecond line",
        raw: {},
      },
      traceText,
    });

    expect(second.liveReasoning).toBe("First line\n\nSecond line");
    expect(second.traceItems[0]).toMatchObject({
      title: "Assistant thinking",
      detail: "First line\n\nSecond line",
    });
  });
});

describe("mergeStreamingText", () => {
  it("inserts spaces between ascii word tokens when the stream omits them", () => {
    expect(mergeStreamingText("The", "user")).toBe("The user");
    expect(mergeStreamingText("The user", "wants")).toBe("The user wants");
    expect(mergeStreamingText("\"夏仲奇\".", "Let")).toBe("\"夏仲奇\". Let");
    expect(mergeStreamingText("containing", "\"夏仲奇\"")).toBe(
      "containing \"夏仲奇\"",
    );
  });

  it("replaces token-joined text when a later cumulative delta arrives", () => {
    const tokenized = [
      "The",
      "user",
      "wants",
      "me",
      "to",
      "search",
    ].reduce((current, delta) => mergeStreamingText(current, delta), "");

    expect(tokenized).toBe("The user wants me to search");
    expect(
      mergeStreamingText(
        tokenized,
        "The user wants me to search the case library.",
      ),
    ).toBe("The user wants me to search the case library.");
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

  it("tolerates failed turns that omit the events array", () => {
    const hydrated = applyPublicAPITurnSnapshot({
      current: createPublicAPIRunReadModel(),
      turn: {
        id: "turn_failed",
        object: "turn",
        created_at: 3,
        status: "failed",
        agent: "demo-agent",
        thread_id: "thread-1",
        output_text: "",
        reasoning_text: "",
        events: undefined,
        usage: {
          input_tokens: 1,
          output_tokens: 0,
          total_tokens: 1,
        },
      } as unknown as Parameters<typeof applyPublicAPITurnSnapshot>[0]["turn"],
      traceText,
    });

    expect(hydrated.phase).toBe("failed");
    expect(hydrated.traceItems).toHaveLength(0);
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
