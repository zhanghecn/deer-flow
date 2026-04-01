import { describe, expect, it } from "vitest";

import {
  DEFAULT_SUBAGENT_ENABLED,
  getResolvedThreadMode,
  normalizeThreadMode,
  resolveSubmitFlags,
} from "./mode";

describe("thread mode helpers", () => {
  it("normalizes legacy modes to pro", () => {
    expect(normalizeThreadMode("thinking")).toBe("pro");
    expect(normalizeThreadMode("ultra")).toBe("pro");
    expect(getResolvedThreadMode(undefined)).toBe("pro");
  });

  it("maps flash mode to deterministic runtime flags", () => {
    expect(resolveSubmitFlags("flash")).toEqual({
      mode: "flash",
      thinking_enabled: false,
      is_plan_mode: false,
      subagent_enabled: DEFAULT_SUBAGENT_ENABLED,
      reasoning_effort: "minimal",
    });
  });

  it("maps pro mode to deterministic runtime flags", () => {
    expect(resolveSubmitFlags("pro")).toEqual({
      mode: "pro",
      thinking_enabled: true,
      is_plan_mode: false,
      subagent_enabled: DEFAULT_SUBAGENT_ENABLED,
      reasoning_effort: "high",
    });
  });

  it("respects explicit subagent opt-in without enabling planner mode", () => {
    expect(
      resolveSubmitFlags("pro", {
        subagentEnabled: true,
      }),
    ).toEqual({
      mode: "pro",
      thinking_enabled: true,
      is_plan_mode: false,
      subagent_enabled: true,
      reasoning_effort: "high",
    });
  });
});
