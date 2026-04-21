import { beforeEach, describe, expect, it, vi } from "vitest";

describe("auth store", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("returns a stable snapshot until auth state changes", async () => {
    const { getAuthSnapshot, markAuthHydrated, setAuth } = await import("./store");

    const initialSnapshot = getAuthSnapshot();
    const repeatedSnapshot = getAuthSnapshot();
    expect(repeatedSnapshot).toBe(initialSnapshot);

    markAuthHydrated();
    const hydratedSnapshot = getAuthSnapshot();
    expect(hydratedSnapshot).not.toBe(initialSnapshot);
    expect(hydratedSnapshot.ready).toBe(true);

    setAuth("session-token", {
      id: "user-1",
      email: "admin@example.com",
      name: "Admin",
      role: "admin",
    });
    const authenticatedSnapshot = getAuthSnapshot();
    expect(authenticatedSnapshot).not.toBe(hydratedSnapshot);
    expect(authenticatedSnapshot.token).toBe("session-token");
    expect(authenticatedSnapshot.user?.role).toBe("admin");
  });
});
