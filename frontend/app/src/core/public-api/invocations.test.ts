import { describe, expect, it } from "vitest";

import type { ExecutionStatus } from "@/core/threads";

import {
  mergeExecutionStatusWithPublicAPIStatus,
  publicAPIInvocationToExecutionStatus,
  type PublicAPIInvocation,
} from "./invocations";

function invocation(
  overrides: Partial<PublicAPIInvocation>,
): PublicAPIInvocation {
  return {
    id: "invocation-1",
    response_id: "resp_1",
    surface: "turns",
    agent_name: "demo-agent",
    thread_id: "thread-1",
    request_model: "model-a",
    status: "completed",
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    created_at: "2026-05-25T10:00:00Z",
    finished_at: "2026-05-25T10:01:00Z",
    ...overrides,
  };
}

const completedStatus: ExecutionStatus = {
  event: "completed",
  phase: "thinking_finalize",
  phase_kind: "model",
  started_at: "2026-05-25T10:00:00Z",
  run_started_at: "2026-05-25T10:00:00Z",
  finished_at: "2026-05-25T10:01:00Z",
  terminal: true,
};

const runningStatus: ExecutionStatus = {
  event: "phase_started",
  phase: "tool_run",
  phase_kind: "tool",
  started_at: "2026-05-25T10:00:00Z",
  run_started_at: "2026-05-25T10:00:00Z",
  terminal: false,
};

describe("public API invocation status", () => {
  it("maps canceled SDK turns to a durable stopped execution status", () => {
    const status = publicAPIInvocationToExecutionStatus(
      invocation({
        response_id: "resp_canceled",
        status: "canceled",
        error: "turn canceled",
      }),
    );

    expect(status?.event).toBe("interrupted");
    expect(status?.error).toContain("turn canceled");
    expect(status?.error).toContain("Response ID: resp_canceled");
  });

  it("maps failed SDK turns to a durable failed execution status", () => {
    const status = publicAPIInvocationToExecutionStatus(
      invocation({
        response_id: "resp_failed",
        trace_id: "trace_failed",
        status: "failed",
        error: "assistant response text was not found in thread state",
      }),
    );

    expect(status?.event).toBe("failed");
    expect(status?.error).toContain(
      "assistant response text was not found in thread state",
    );
    expect(status?.error).toContain("Trace ID: trace_failed");
  });

  it("uses unsuccessful public API status when live state only completed", () => {
    const publicStatus = publicAPIInvocationToExecutionStatus(
      invocation({ status: "canceled", error: "turn canceled" }),
    );

    expect(
      mergeExecutionStatusWithPublicAPIStatus(completedStatus, publicStatus),
    ).toBe(publicStatus);
  });

  it("keeps live running state ahead of stale public API status", () => {
    const publicStatus = publicAPIInvocationToExecutionStatus(
      invocation({ status: "canceled", error: "turn canceled" }),
    );

    expect(
      mergeExecutionStatusWithPublicAPIStatus(runningStatus, publicStatus),
    ).toBe(runningStatus);
  });
});
