import { describe, expect, it } from "vitest";

import type { PublicAPIResponseEnvelope } from "./api";
import {
  applyNormalizedPublicAPIRunEvent,
  applyPublicAPIResponseEnvelope,
  buildPublicAPIReasoningRequest,
  createPublicAPIRunReadModel,
  extractPublicAPIReasoningSummary,
  formatPublicAPIOutputText,
} from "./run-session";

const traceText = {
  assistantMessage: "Assistant message",
  toolCall: "Tool call",
  toolResult: "Tool result",
  runCompleted: "Run completed",
};

describe("buildPublicAPIReasoningRequest", () => {
  it("returns undefined when reasoning is disabled", () => {
    expect(buildPublicAPIReasoningRequest(false, "medium")).toBeUndefined();
  });

  it("builds the expected public reasoning payload", () => {
    expect(buildPublicAPIReasoningRequest(true, "high")).toEqual({
      effort: "high",
      summary: "detailed",
    });
  });
});

describe("extractPublicAPIReasoningSummary", () => {
  it("joins reasoning summary blocks from the response output", () => {
    const response = {
      id: "resp_1",
      object: "response",
      created_at: 1,
      status: "completed",
      model: "demo-agent",
      output_text: "done",
      output: [
        {
          id: "rs_1",
          type: "reasoning",
          summary: [
            { type: "summary_text", text: "First step" },
            { type: "summary_text", text: "Second step" },
          ],
        },
      ],
    } as PublicAPIResponseEnvelope;

    expect(extractPublicAPIReasoningSummary(response)).toBe(
      "First step\n\nSecond step",
    );
  });
});

describe("applyNormalizedPublicAPIRunEvent", () => {
  it("accumulates assistant deltas and unique ledger trace items", () => {
    const started = applyNormalizedPublicAPIRunEvent({
      current: createPublicAPIRunReadModel(),
      event: {
        kind: "run_started",
        responseId: "resp_1",
        raw: {},
      },
      traceText,
    });
    const withDelta = applyNormalizedPublicAPIRunEvent({
      current: started,
      event: {
        kind: "assistant_delta",
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
          event_index: 2,
          created_at: 2,
          type: "tool_started",
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
          event_index: 2,
          created_at: 2,
          type: "tool_started",
          tool_name: "grep_files",
        },
        raw: {},
      },
      traceText,
    });

    expect(dedupedTool.responseId).toBe("resp_1");
    expect(dedupedTool.liveOutput).toBe("hello");
    expect(dedupedTool.traceItems).toHaveLength(1);
    expect(dedupedTool.toolCallCount).toBe(1);
  });
});

describe("applyPublicAPIResponseEnvelope", () => {
  it("hydrates the final response without duplicating seen run events", () => {
    const current = applyNormalizedPublicAPIRunEvent({
      current: createPublicAPIRunReadModel(),
      event: {
        kind: "ledger_event",
        event: {
          event_index: 1,
          created_at: 1,
          type: "tool_started",
          tool_name: "list_files",
        },
        raw: {},
      },
      traceText,
    });

    const hydrated = applyPublicAPIResponseEnvelope({
      current,
      response: {
        id: "resp_2",
        object: "response",
        created_at: 2,
        status: "completed",
        model: "demo-agent",
        output_text: "done",
        output: [
          {
            id: "rs_2",
            type: "reasoning",
            summary: [{ type: "summary_text", text: "Projected summary" }],
          },
        ],
        openagents: {
          thread_id: "thread-1",
          run_events: [
            {
              event_index: 1,
              created_at: 1,
              type: "tool_started",
              tool_name: "list_files",
            },
            {
              event_index: 2,
              created_at: 2,
              type: "run_completed",
              response_id: "resp_2",
            },
          ],
        },
      },
      traceText,
    });

    expect(hydrated.traceItems).toHaveLength(2);
    expect(hydrated.toolCallCount).toBe(1);
    expect(hydrated.reasoningSummary).toBe("Projected summary");
    expect(hydrated.liveOutput).toBe("done");
    expect(hydrated.phase).toBe("ready");
  });
});

describe("formatPublicAPIOutputText", () => {
  it("pretty-prints JSON output text", () => {
    expect(
      formatPublicAPIOutputText(
        {
          id: "resp_3",
          object: "response",
          created_at: 3,
          status: "completed",
          model: "demo-agent",
          output_text: '{"ok":true}',
        } as PublicAPIResponseEnvelope,
        "",
      ),
    ).toBe('{\n  "ok": true\n}');
  });
});
