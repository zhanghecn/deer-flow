import { beforeEach, describe, expect, it, vi } from "vitest";

const clientConstructor = vi.fn();
const getAuthToken = vi.fn();
const getAuthUser = vi.fn();
const getLangGraphBaseURL = vi.fn();

vi.mock("@langchain/langgraph-sdk/client", () => ({
  Client: clientConstructor.mockImplementation((config: unknown) => ({
    config,
    defaultHeaders: (config as { defaultHeaders?: Record<string, string> })
      .defaultHeaders,
  })),
}));

vi.mock("@/core/auth/store", () => ({
  getAuthToken: () => getAuthToken(),
  getAuthUser: () => getAuthUser(),
}));

vi.mock("../config", () => ({
  getLangGraphBaseURL: (...args: unknown[]) => getLangGraphBaseURL(...args),
}));

describe("getAPIClient", () => {
  beforeEach(() => {
    vi.resetModules();
    clientConstructor.mockReset();
    getAuthToken.mockReset().mockReturnValue("token-1");
    getAuthUser.mockReset().mockReturnValue({ id: "user-1" });
    getLangGraphBaseURL.mockReset().mockReturnValue(
      "http://example.test/api/langgraph",
    );
  });

  it("includes thread runtime identity in default headers", async () => {
    const { getAPIClient } = await import("./api-client");

    const client = getAPIClient(false, "thread-123") as unknown as {
      defaultHeaders: Record<string, string>;
    };

    expect(clientConstructor).toHaveBeenCalledWith({
      apiUrl: "http://example.test/api/langgraph",
      defaultHeaders: {
        Authorization: "Bearer token-1",
        "x-user-id": "user-1",
        "x-thread-id": "thread-123",
      },
    });
    expect(client.defaultHeaders["x-thread-id"]).toBe("thread-123");
  });

  it("reuses a client for the same thread and isolates different threads", async () => {
    const { getAPIClient } = await import("./api-client");

    const first = getAPIClient(false, "thread-a");
    const second = getAPIClient(false, "thread-a");
    const third = getAPIClient(false, "thread-b");

    expect(first).toBe(second);
    expect(first).not.toBe(third);
    expect(clientConstructor).toHaveBeenCalledTimes(2);
  });
});
