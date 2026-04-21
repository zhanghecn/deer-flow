import { beforeEach, describe, expect, it, vi } from "vitest";

describe("auth api", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("restores auth state from an existing session cookie", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        token: "session-token",
        user: {
          id: "user-1",
          email: "admin@example.com",
          name: "Admin",
          role: "admin",
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { restoreAuthSession } = await import("./api");
    const { getAuthToken, getAuthUser, isAuthReady } = await import("./store");

    await restoreAuthSession();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/session"),
      expect.objectContaining({
        method: "GET",
        credentials: "include",
      }),
    );
    expect(isAuthReady()).toBe(true);
    expect(getAuthToken()).toBe("session-token");
    expect(getAuthUser()?.role).toBe("admin");
  });

  it("marks auth ready and clears stale state when session restore fails", async () => {
    localStorage.setItem(
      "openagents-auth",
      JSON.stringify({
        token: null,
        user: null,
      }),
    );
    const fetchMock = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: "unauthorized" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { restoreAuthSession } = await import("./api");
    const { getAuthToken, getAuthUser, isAuthReady } = await import("./store");

    await restoreAuthSession();

    expect(isAuthReady()).toBe(true);
    expect(getAuthToken()).toBeNull();
    expect(getAuthUser()).toBeNull();
    expect(localStorage.getItem("openagents-auth")).toBeNull();
  });
});
