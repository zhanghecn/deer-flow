import { describe, expect, it } from "vitest";

import {
  CANONICAL_RUN_EVENT_TYPES,
  isCanonicalRunEventType,
} from "./canonical";

describe("canonical run event types", () => {
  it("accepts the supported v1 event budget", () => {
    expect(CANONICAL_RUN_EVENT_TYPES).toEqual([
      "run_started",
      "assistant_delta",
      "assistant_message",
      "tool_started",
      "tool_finished",
      "question_requested",
      "question_answered",
      "run_completed",
      "run_failed",
    ]);
  });

  it("guards unknown event names out of the canonical contract", () => {
    expect(isCanonicalRunEventType("run_started")).toBe(true);
    expect(isCanonicalRunEventType("task_running")).toBe(false);
  });
});
