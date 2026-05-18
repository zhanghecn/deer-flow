import { describe, expect, it, vi } from "vitest";

import { isChunkLoadError, recoverChunkLoadError } from "./chunk-load-recovery";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

describe("chunk load recovery", () => {
  it("recognizes stale lazy route chunk failures", () => {
    expect(
      isChunkLoadError(
        new TypeError("Failed to fetch dynamically imported module"),
      ),
    ).toBe(true);
    expect(
      isChunkLoadError(new Error("ChunkLoadError: Loading chunk 42 failed")),
    ).toBe(true);
    expect(isChunkLoadError(new Error("regular runtime failure"))).toBe(false);
  });

  it("reloads once for a stale chunk on the same URL", () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    const error = new Error("Failed to fetch dynamically imported module");

    expect(
      recoverChunkLoadError(error, {
        href: "http://localhost/workspace/chats/1",
        reload,
        storage,
      }),
    ).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);

    expect(
      recoverChunkLoadError(error, {
        href: "http://localhost/workspace/chats/1",
        reload,
        storage,
      }),
    ).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload for non-chunk errors", () => {
    const storage = memoryStorage();
    const reload = vi.fn();

    expect(
      recoverChunkLoadError(new Error("render failed"), {
        href: "http://localhost/workspace/chats/1",
        reload,
        storage,
      }),
    ).toBe(false);

    expect(reload).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
