import { describe, expect, it } from "vitest";

import { getUserVisibleRuntimePath } from "./files";

describe("getUserVisibleRuntimePath", () => {
  it("reduces runtime output paths to their filenames", () => {
    expect(
      getUserVisibleRuntimePath("/mnt/user-data/outputs/short-intro.md"),
    ).toBe("short-intro.md");
  });

  it("keeps non-runtime paths unchanged", () => {
    expect(getUserVisibleRuntimePath("/tmp/demo.txt")).toBe("/tmp/demo.txt");
  });
});
