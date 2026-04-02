import { describe, expect, it } from "vitest";

import { getUserVisibleRuntimePath } from "./files";

describe("getUserVisibleRuntimePath", () => {
  it("reduces runtime output paths to their filenames", () => {
    expect(
      getUserVisibleRuntimePath("/mnt/user-data/outputs/short-intro.md"),
    ).toBe("short-intro.md");
  });

  it("can keep the full virtual runtime path when compact mode is disabled", async () => {
    const { getUserVisibleRuntimePathWithOptions } = await import("./files");

    expect(
      getUserVisibleRuntimePathWithOptions(
        "/mnt/user-data/agents/dev/lead_agent/skills/surprise-me/SKILL.md",
        { compact: false },
      ),
    ).toBe(
      "/mnt/user-data/agents/dev/lead_agent/skills/surprise-me/SKILL.md",
    );
  });

  it("keeps non-runtime paths unchanged", () => {
    expect(getUserVisibleRuntimePath("/tmp/demo.txt")).toBe("/tmp/demo.txt");
  });
});
