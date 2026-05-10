import { beforeEach, describe, expect, it } from "vitest";

import {
  getStoredThreadWorkbenchHint,
  persistThreadWorkbenchHint,
} from "./storage";

describe("workspace surface storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists a lightweight thread workbench hint for refresh recovery", () => {
    persistThreadWorkbenchHint(" thread-1 ", {
      surface: "runtime",
      target_path: " /mnt/user-data/workspace ",
    });

    expect(getStoredThreadWorkbenchHint("thread-1")).toEqual({
      surface: "runtime",
      artifact_path: undefined,
      target_path: "/mnt/user-data/workspace",
      updated_at: expect.any(String),
    });
  });

  it("ignores malformed stored hints", () => {
    window.localStorage.setItem(
      "openagents.workspace-thread-hints",
      JSON.stringify({
        "thread-1": {
          surface: "not-a-surface",
          target_path: "/mnt/user-data/workspace",
          updated_at: "2026-04-13T00:00:00.000Z",
        },
      }),
    );

    expect(getStoredThreadWorkbenchHint("thread-1")).toBeNull();
  });
});
