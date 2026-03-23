import { describe, expect, it } from "vitest";

import { mergeVisibleArtifacts } from "./utils";

describe("mergeVisibleArtifacts", () => {
  it("keeps explicit artifact order and appends discovered output files", () => {
    expect(
      mergeVisibleArtifacts(
        ["/mnt/user-data/outputs/bundle/index.html"],
        [
          "/mnt/user-data/outputs/bundle/dragon.jpg",
          "/mnt/user-data/outputs/bundle/index.html",
          "/mnt/user-data/outputs/bundle/phoenix.jpg",
        ],
      ),
    ).toEqual([
      "/mnt/user-data/outputs/bundle/index.html",
      "/mnt/user-data/outputs/bundle/dragon.jpg",
      "/mnt/user-data/outputs/bundle/phoenix.jpg",
    ]);
  });
});
