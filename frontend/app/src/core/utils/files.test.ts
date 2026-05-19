import { describe, expect, it } from "vitest";

import { checkCodeFile, getUserVisibleRuntimePath } from "./files";

describe("getUserVisibleRuntimePath", () => {
  it("reduces runtime output paths to their filenames", () => {
    expect(
      getUserVisibleRuntimePath("/mnt/user-data/outputs/short-intro.md"),
    ).toBe("short-intro.md");
  });

  it("labels the shared tmp root when no child path is present", async () => {
    const { getUserVisibleRuntimePathWithOptions } = await import("./files");

    expect(
      getUserVisibleRuntimePathWithOptions("/mnt/user-data/tmp", {
        compact: true,
      }),
    ).toBe("shared tmp");
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

  it("previews JSONL artifacts as text data files", () => {
    expect(checkCodeFile("/mnt/user-data/outputs/bazi/result.jsonl")).toEqual({
      isCodeFile: true,
      language: "json",
    });
  });
});
