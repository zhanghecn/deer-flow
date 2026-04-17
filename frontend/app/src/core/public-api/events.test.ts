import { describe, expect, it } from "vitest";

import type { PublicAPITurnStreamEvent } from "./api";
import {
  buildTraceFromRunEvent,
  normalizePublicAPIStreamEvent,
} from "./events";

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

describe("normalizePublicAPIStreamEvent", () => {
  it("normalizes the native turns streaming lifecycle", () => {
    const events: PublicAPITurnStreamEvent[] = [
      {
        event: "turn.started",
        data: {
          sequence: 1,
          created_at: 1,
          type: "turn.started",
          turn_id: "turn_123",
        },
      },
      {
        event: "assistant.text.delta",
        data: {
          sequence: 2,
          created_at: 2,
          type: "assistant.text.delta",
          turn_id: "turn_123",
          delta: "hello",
        },
      },
      {
        event: "tool.call.started",
        data: {
          sequence: 3,
          created_at: 3,
          type: "tool.call.started",
          turn_id: "turn_123",
          tool_name: "bash",
          tool_arguments: { cmd: "echo hi" },
        },
      },
      {
        event: "turn.completed",
        data: {
          sequence: 4,
          created_at: 4,
          type: "turn.completed",
          turn_id: "turn_123",
        },
      },
    ];

    const normalized = events.flatMap(normalizePublicAPIStreamEvent);

    expect(normalized).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "turn_started",
          turnId: "turn_123",
        }),
        expect.objectContaining({
          kind: "assistant_text_delta",
          delta: "hello",
        }),
        expect.objectContaining({
          kind: "ledger_event",
          event: expect.objectContaining({
            type: "tool.call.started",
            tool_name: "bash",
            tool_arguments: { cmd: "echo hi" },
          }),
        }),
        expect.objectContaining({
          kind: "turn_completed",
          turnId: "turn_123",
        }),
      ]),
    );
  });

  it("turns error payloads into a terminal failure event", () => {
    const normalized = normalizePublicAPIStreamEvent({
      event: "error",
      data: { error: "runtime_error", details: "boom" },
    });

    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({
      kind: "turn_failed",
    });
  });
});

describe("buildTraceFromRunEvent", () => {
  it("maps assistant tool calls into a readable trace entry", () => {
    const trace = buildTraceFromRunEvent(
      {
        sequence: 2,
        created_at: 10,
        type: "tool.call.started",
        turn_id: "turn_1",
        tool_name: "bash",
        tool_arguments: { cmd: "echo hi" },
      },
      traceText,
    );

    expect(trace).toMatchObject({
      stage: "run",
      tone: "tool",
      title: "Tool call",
      detail: expect.stringContaining("`bash`"),
      timestamp: 10000,
    });
    expect(trace.detail).toContain("```json");
  });

  it("maps requires-input events into system trace entries", () => {
    const trace = buildTraceFromRunEvent(
      {
        sequence: 3,
        created_at: 11,
        type: "turn.requires_input",
        turn_id: "turn_1",
        text: "question-1",
      },
      traceText,
    );

    expect(trace).toMatchObject({
      stage: "run",
      tone: "system",
      title: "Turn waiting",
      detail: "question-1",
      timestamp: 11000,
    });
  });
});
