import { beforeEach, describe, expect, it, vi } from "vitest";

const getBackendBaseURL = vi.fn();

vi.mock("../config", () => ({
  getBackendBaseURL: (...args: unknown[]) => getBackendBaseURL(...args),
}));

describe("public agent export api", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getBackendBaseURL.mockReset().mockReturnValue("http://example.test");
  });

  it("returns a clear unpublished-agent error on 404 export fetches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: vi.fn().mockResolvedValue({ error: "agent not found" }),
      }),
    );

    const { getPublicAgentExportDoc } = await import("./api");

    await expect(getPublicAgentExportDoc("draft-agent")).rejects.toThrow(
      "Published agent docs are only available after the agent is published to prod.",
    );
  });
});
