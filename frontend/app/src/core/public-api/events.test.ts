import { describe, expect, it } from "vitest";

import type { PublicAPIStreamEvent } from "./api";
import {
  buildTraceFromRunEvent,
  normalizePublicAPIStreamEvent,
} from "./events";

const traceText = {
  assistantMessage: "Assistant message",
  toolCall: "Tool call",
  toolResult: "Tool result",
  runCompleted: "Run completed",
};

describe("normalizePublicAPIStreamEvent", () => {
  it("normalizes the streaming lifecycle into a smaller run event set", () => {
    const events: PublicAPIStreamEvent[] = [
      {
        event: "response.run_event",
        data: {
          event: {
            event_index: 1,
            created_at: 1,
            type: "run_started",
            response_id: "resp_123",
          },
        },
      },
      {
        event: "response.run_event",
        data: {
          event: {
            event_index: 2,
            created_at: 2,
            type: "assistant_delta",
            delta: "hello",
            response_id: "resp_123",
          },
        },
      },
      {
        event: "response.run_event",
        data: {
          event: {
            event_index: 2,
            created_at: 1,
            type: "tool_started",
            tool_name: "bash",
          },
        },
      },
      {
        event: "response.run_event",
        data: {
          event: {
            event_index: 4,
            created_at: 4,
            type: "run_completed",
            response_id: "resp_123",
          },
        },
      },
    ];

    const normalized = events.flatMap(normalizePublicAPIStreamEvent);

    expect(normalized).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "run_started",
          responseId: "resp_123",
        }),
        expect.objectContaining({
          kind: "assistant_delta",
          delta: "hello",
        }),
        expect.objectContaining({
          kind: "ledger_event",
          event: expect.objectContaining({
            type: "tool_started",
            tool_name: "bash",
          }),
        }),
        expect.objectContaining({
          kind: "run_completed",
          responseId: "resp_123",
        }),
      ]),
    );
  });

  it("keeps legacy response.completed payloads readable during the cutover", () => {
    const normalized = normalizePublicAPIStreamEvent({
      event: "response.completed",
      data: {
        response: {
          id: "resp_legacy",
          object: "response",
          created_at: 1,
          status: "completed",
          model: "demo-agent",
          output_text: "done",
        },
      },
    });

    expect(normalized).toMatchObject([
      { kind: "run_completed", responseId: "resp_legacy" },
    ]);
  });

  it("turns error payloads into a terminal failure event", () => {
    const normalized = normalizePublicAPIStreamEvent({
      event: "error",
      data: { error: "runtime_error", details: "boom" },
    });

    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({
      kind: "run_failed",
    });
  });
});

describe("buildTraceFromRunEvent", () => {
  it("maps assistant tool calls into a readable trace entry", () => {
    const trace = buildTraceFromRunEvent(
      {
        event_index: 2,
        created_at: 10,
        type: "tool_started",
        tool_name: "bash",
      },
      traceText,
    );

    expect(trace).toMatchObject({
      stage: "run",
      tone: "tool",
      title: "Tool call",
      detail: "bash",
      timestamp: 10000,
    });
  });

  it("maps question events into system trace entries", () => {
    const trace = buildTraceFromRunEvent(
      {
        event_index: 3,
        created_at: 11,
        type: "question_requested",
        question_id: "question-1",
      },
      traceText,
    );

    expect(trace).toMatchObject({
      stage: "run",
      tone: "system",
      title: "Question requested",
      detail: "question-1",
      timestamp: 11000,
    });
  });
});
