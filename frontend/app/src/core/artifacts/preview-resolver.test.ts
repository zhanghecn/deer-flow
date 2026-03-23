import { describe, expect, it } from "vitest";

import { getBackendBaseURL } from "@/core/config";

import {
  resolveArtifactPreviewURL,
  resolveThreadScopedPath,
} from "./preview-resolver";

describe("resolveThreadScopedPath", () => {
  it("resolves workspace references from an output artifact", () => {
    expect(
      resolveThreadScopedPath(
        "../workspace/dragon-constellation.jpg",
        "outputs/celestial-menagerie/index.html",
      ),
    ).toBe("/mnt/user-data/workspace/dragon-constellation.jpg");
  });

  it("resolves assets relative to the current artifact directory", () => {
    expect(
      resolveThreadScopedPath("./assets/cover.png", "outputs/demo/index.html"),
    ).toBe("/mnt/user-data/outputs/demo/assets/cover.png");
  });

  it("normalizes encoded paths without double encoding", () => {
    expect(
      resolveThreadScopedPath(
        "./assets/My%20Image.png",
        "outputs/demo/index.html",
      ),
    ).toBe("/mnt/user-data/outputs/demo/assets/My Image.png");
  });

  it("ignores external links and anchors", () => {
    expect(
      resolveThreadScopedPath(
        "https://example.com/image.png",
        "outputs/demo/index.html",
      ),
    ).toBeNull();
    expect(
      resolveThreadScopedPath("#gallery", "outputs/demo/index.html"),
    ).toBeNull();
  });
});

describe("resolveArtifactPreviewURL", () => {
  it("builds authenticated artifact urls for internal references", () => {
    const artifactBaseURL = `${getBackendBaseURL()}/api/threads/thread-1/artifacts`;

    expect(
      resolveArtifactPreviewURL({
        reference: "./assets/cover.png",
        filepath: "outputs/demo/index.html",
        threadId: "thread-1",
      }),
    ).toBe(`${artifactBaseURL}/mnt/user-data/outputs/demo/assets/cover.png`);
  });
});
