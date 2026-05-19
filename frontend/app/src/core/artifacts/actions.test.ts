import { beforeEach, describe, expect, it, vi } from "vitest";

import { openArtifactInNewWindow } from "./actions";
import { loadArtifactBlob } from "./loader";

vi.mock("./loader", () => ({
  loadArtifactBlob: vi.fn(),
}));

describe("artifact actions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("opens html artifacts through one noopener anchor without window.open", async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    await openArtifactInNewWindow({
      filepath: "/mnt/user-data/outputs/demo/index.html",
      threadId: "thread-1",
    });

    expect(open).not.toHaveBeenCalled();
    expect(loadArtifactBlob).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.instances[0] as HTMLAnchorElement | undefined;
    expect(anchor).toBeDefined();
    if (!anchor) {
      throw new Error("Expected artifact open action to click an anchor");
    }
    expect(anchor.href).toContain(
      "/api/threads/thread-1/artifacts/mnt/user-data/outputs/demo/index.html",
    );
    expect(anchor.target).toBe("_blank");
    expect(anchor.rel).toBe("noopener noreferrer");
  });

  it("opens non-html artifacts from a fetched object URL", async () => {
    vi.mocked(loadArtifactBlob).mockResolvedValue(
      new Blob(["demo"], { type: "text/plain" }),
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const createObjectURL = vi.fn().mockReturnValue("blob:artifact");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });

    await openArtifactInNewWindow({
      filepath: "/mnt/user-data/outputs/demo/report.md",
      threadId: "thread-1",
    });

    expect(loadArtifactBlob).toHaveBeenCalledWith({
      filepath: "/mnt/user-data/outputs/demo/report.md",
      threadId: "thread-1",
      isMock: undefined,
      preview: undefined,
    });
    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.instances[0] as HTMLAnchorElement | undefined;
    expect(anchor?.href).toBe("blob:artifact");
  });
});
