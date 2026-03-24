import { describe, expect, it } from "vitest";

import { shouldShowTrailingReasoning } from "./message-group";

describe("shouldShowTrailingReasoning", () => {
  it("keeps trailing reasoning visible while the turn is still streaming", () => {
    expect(shouldShowTrailingReasoning("assistant", true)).toBe(true);
  });

  it("hides trailing reasoning when a completed processing group is followed by a visible assistant reply", () => {
    expect(shouldShowTrailingReasoning("assistant", false)).toBe(false);
  });

  it("keeps trailing reasoning when there is no follow-up assistant group", () => {
    expect(shouldShowTrailingReasoning(undefined, false)).toBe(true);
  });
});
