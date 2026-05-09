import { describe, expect, it, vi } from "vitest";

import type * as PublicAPIModule from "./api";
import { createPublicAPISession } from "./session";

const {
  createPublicAPITurnMock,
  runStreamedPublicAPITurnMock,
} = vi.hoisted(() => ({
  createPublicAPITurnMock: vi.fn(),
  runStreamedPublicAPITurnMock: vi.fn(),
}));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof PublicAPIModule>("./api");
  return {
    ...actual,
    createPublicAPITurn: createPublicAPITurnMock,
  };
});

vi.mock("./turn-runner", () => ({
  runStreamedPublicAPITurn: runStreamedPublicAPITurnMock,
}));

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

describe("createPublicAPISession", () => {
  it("keeps one session_id across streamed prompts", async () => {
    runStreamedPublicAPITurnMock
      .mockResolvedValueOnce({
        readModel: {
          liveOutput: "first",
          liveReasoning: "",
          traceItems: [],
          toolCallCount: 0,
          turnId: "turn_1",
          turn: null,
          phase: "ready",
          seenEventKeys: [],
        },
        turn: {
          id: "turn_1",
          object: "turn",
          status: "completed",
          agent: "support-demo",
          session_id: "session_demo",
          thread_id: "thread_1",
          output_text: "first",
          reasoning_text: "",
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            total_tokens: 2,
          },
          events: [],
          created_at: 1,
        },
      })
      .mockResolvedValueOnce({
        readModel: {
          liveOutput: "second",
          liveReasoning: "",
          traceItems: [],
          toolCallCount: 0,
          turnId: "turn_2",
          turn: null,
          phase: "ready",
          seenEventKeys: [],
        },
        turn: {
          id: "turn_2",
          object: "turn",
          status: "completed",
          agent: "support-demo",
          session_id: "session_demo",
          thread_id: "thread_1",
          output_text: "second",
          reasoning_text: "",
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            total_tokens: 2,
          },
          events: [],
          created_at: 2,
        },
      });

    const session = createPublicAPISession({
      baseURL: "http://127.0.0.1:8083/v1",
      apiToken: "token",
      agent: "support-demo",
      traceText,
      sessionId: "session_demo",
    });

    const first = await session.prompt({ text: "first question" });
    const second = await session.prompt({ text: "second question" });

    expect(first.requestBody.session_id).toBe("session_demo");
    expect(second.requestBody.session_id).toBe("session_demo");
    expect(session.getSessionId()).toBe("session_demo");
    expect(session.getLastTurn()?.id).toBe("turn_2");
  });

  it("supports seeded session ids without forcing callers to resend history", async () => {
    runStreamedPublicAPITurnMock.mockResolvedValueOnce({
      readModel: {
        liveOutput: "continued",
        liveReasoning: "",
        traceItems: [],
        toolCallCount: 0,
        turnId: "turn_9",
        turn: null,
        phase: "ready",
        seenEventKeys: [],
      },
      turn: {
        id: "turn_9",
        object: "turn",
        status: "completed",
        agent: "support-demo",
        session_id: "session_seed",
        thread_id: "thread_1",
        output_text: "continued",
        reasoning_text: "",
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          total_tokens: 2,
        },
        events: [],
        created_at: 9,
      },
    });

    const session = createPublicAPISession({
      baseURL: "http://127.0.0.1:8083/v1",
      apiToken: "token",
      agent: "support-demo",
      traceText,
      sessionId: "session_seed",
    });

    const result = await session.prompt({ text: "continue" });

    expect(result.requestBody.session_id).toBe("session_seed");
    expect(session.getLastTurn()?.id).toBe("turn_9");
  });

  it("creates a new session id on reset", async () => {
    runStreamedPublicAPITurnMock.mockResolvedValueOnce({
      readModel: {
        liveOutput: "first",
        liveReasoning: "",
        traceItems: [],
        toolCallCount: 0,
        turnId: "turn_1",
        turn: null,
        phase: "ready",
        seenEventKeys: [],
      },
      turn: {
        id: "turn_1",
        object: "turn",
        status: "completed",
        agent: "support-demo",
        thread_id: "thread_1",
        output_text: "first",
        reasoning_text: "",
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          total_tokens: 2,
        },
        events: [],
        created_at: 1,
      },
    });

    const session = createPublicAPISession({
      baseURL: "http://127.0.0.1:8083/v1",
      apiToken: "token",
      agent: "support-demo",
      traceText,
      sessionId: "session_before_reset",
    });

    await session.prompt({ text: "first question" });
    session.reset();

    expect(session.getSessionId()).not.toBe("session_before_reset");
    expect(session.getLastTurn()).toBeNull();
  });

  it("supports blocking prompts and keeps the session id", async () => {
    createPublicAPITurnMock.mockResolvedValueOnce({
      id: "turn_blocking",
      object: "turn",
      status: "completed",
      agent: "support-demo",
      thread_id: "thread_1",
      output_text: "done",
      reasoning_text: "reasoning",
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
      },
      events: [],
      created_at: 1,
    });

    const session = createPublicAPISession({
      baseURL: "http://127.0.0.1:8083/v1",
      apiToken: "token",
      agent: "support-demo",
      traceText,
      sessionId: "session_blocking",
    });

    const result = await session.prompt({
      text: "blocking question",
      stream: false,
    });

    expect(createPublicAPITurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          session_id: "session_blocking",
          stream: false,
        }),
      }),
    );
    expect(result.turn?.id).toBe("turn_blocking");
    expect(session.getSessionId()).toBe("session_blocking");
  });

  it("drops effort when reasoning is explicitly disabled", () => {
    const session = createPublicAPISession({
      baseURL: "http://127.0.0.1:8083/v1",
      apiToken: "token",
      agent: "support-demo",
      traceText,
    });

    const requestBody = session.previewRequest({
      text: "no reasoning please",
      thinking: {
        enabled: false,
        effort: "medium",
      },
    });

    expect(requestBody.thinking).toEqual({
      enabled: false,
    });
  });

  it("preserves effort when reasoning stays enabled", () => {
    const session = createPublicAPISession({
      baseURL: "http://127.0.0.1:8083/v1",
      apiToken: "token",
      agent: "support-demo",
      traceText,
    });

    const requestBody = session.previewRequest({
      text: "reason carefully",
      thinking: {
        enabled: true,
        effort: "high",
      },
    });

    expect(requestBody.thinking).toEqual({
      enabled: true,
      effort: "high",
    });
  });
});
