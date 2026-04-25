import { describe, expect, it, vi } from "vitest";

import type * as PublicAPIModule from "./api";
import { runStreamedPublicAPITurn } from "./turn-runner";

const {
  getPublicAPITurnMock,
  streamPublicAPITurnMock,
} = vi.hoisted(() => ({
  getPublicAPITurnMock: vi.fn(),
  streamPublicAPITurnMock: vi.fn(),
}));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof PublicAPIModule>("./api");
  return {
    ...actual,
    getPublicAPITurn: getPublicAPITurnMock,
    streamPublicAPITurn: streamPublicAPITurnMock,
  };
});

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

describe("runStreamedPublicAPITurn", () => {
  it("treats turn.failed without turn_id as a terminal failure without snapshot hydration", async () => {
    streamPublicAPITurnMock.mockImplementationOnce(async ({ onEvent }) => {
      onEvent({
        event: "turn.failed",
        data: {
          sequence: 1,
          created_at: 1,
          type: "turn.failed",
          status: "failed",
          stage: "prepare_run",
          retryable: false,
          error: "model not found",
        },
      });
    });

    const result = await runStreamedPublicAPITurn({
      baseURL: "http://127.0.0.1:8083/v1",
      apiToken: "token",
      body: {
        agent: "demo-agent",
        input: { text: "hello" },
      },
      traceText,
    });

    expect(result.turn).toBeNull();
    expect(result.readModel.phase).toBe("failed");
    expect(getPublicAPITurnMock).not.toHaveBeenCalled();
  });

  it("throws a protocol error when the stream ends without a terminal turn state", async () => {
    streamPublicAPITurnMock.mockImplementationOnce(async ({ onEvent }) => {
      onEvent({
        event: "turn.started",
        data: {
          sequence: 1,
          created_at: 1,
          type: "turn.started",
          turn_id: "turn_123",
        },
      });
      onEvent({
        event: "assistant.text.delta",
        data: {
          sequence: 2,
          created_at: 2,
          type: "assistant.text.delta",
          turn_id: "turn_123",
          delta: "hello",
        },
      });
    });

    await expect(
      runStreamedPublicAPITurn({
        baseURL: "http://127.0.0.1:8083/v1",
        apiToken: "token",
        body: {
          agent: "demo-agent",
          input: { text: "hello" },
        },
        traceText,
      }),
    ).rejects.toThrow("Streaming /v1/turns ended without a terminal turn event.");
  });
});
