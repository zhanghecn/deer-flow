import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildDesignBoardChannelName,
  clearDesignBoardAutoOpened,
  hasDesignBoardAutoOpened,
  markDesignBoardAutoOpened,
  publishDesignBoardRemoteMessage,
} from "./embed";

describe("design board auto-open sentinel", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("marks and reads the per-thread browser-session auto-open sentinel", () => {
    expect(hasDesignBoardAutoOpened("thread-1")).toBe(false);

    markDesignBoardAutoOpened("thread-1");

    expect(hasDesignBoardAutoOpened("thread-1")).toBe(true);
    expect(hasDesignBoardAutoOpened("thread-2")).toBe(false);
  });

  it("clears the auto-open sentinel without touching other threads", () => {
    markDesignBoardAutoOpened("thread-1");
    markDesignBoardAutoOpened("thread-2");

    clearDesignBoardAutoOpened("thread-1");

    expect(hasDesignBoardAutoOpened("thread-1")).toBe(false);
    expect(hasDesignBoardAutoOpened("thread-2")).toBe(true);
  });
});

describe("design board remote channel", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("builds a stable thread-and-path scoped channel name", () => {
    expect(
      buildDesignBoardChannelName({
        thread_id: "thread-7",
        target_path: "/mnt/user-data/outputs/designs/canvas.op",
      }),
    ).toBe(
      "openagents-design:thread-7:%2Fmnt%2Fuser-data%2Foutputs%2Fdesigns%2Fcanvas.op",
    );
  });

  it("publishes the authoritative session tuple into BroadcastChannel", () => {
    const postMessage = vi.fn();
    const close = vi.fn();

    class BroadcastChannelMock {
      constructor(_name: string) {
        void _name;
      }
      postMessage = postMessage;
      close = close;
    }

    vi.stubGlobal("BroadcastChannel", BroadcastChannelMock as never);

    publishDesignBoardRemoteMessage(
      {
        thread_id: "thread-7",
        session_id: "session-9",
        session_generation: 3,
        target_path: "/mnt/user-data/outputs/designs/canvas.op",
      },
      {
        type: "design.remote.revision-available",
        revision: "rev-5",
      },
    );

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "design.remote.revision-available",
        threadId: "thread-7",
        sessionId: "session-9",
        sessionGeneration: 3,
        targetPath: "/mnt/user-data/outputs/designs/canvas.op",
        revision: "rev-5",
      }),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });
});
