import type { DesignBoardSession } from "./api";

const DESIGN_AUTO_OPEN_STORAGE_PREFIX = "openagents.design-autopen:";
const DESIGN_REMOTE_CHANNEL_PREFIX = "openagents-design";

export type DesignBoardRemoteMessageType =
  | "design.remote.revision-available"
  | "design.remote.conflict"
  | "design.remote.session-expired";

export type DesignBoardRemoteMessage = {
  type: DesignBoardRemoteMessageType;
  threadId: string;
  sessionId: string;
  sessionGeneration: number;
  targetPath: string;
  revision: string | null;
  emittedAt: string;
};

export function openDesignBoardTab(session: DesignBoardSession): Window | null {
  // Keep the opener relationship intact for same-origin bridge events so the
  // OpenPencil tab can report selection/save state back into the thread page.
  return window.open(session.relative_url, "_blank");
}

function getAutoOpenStorageKey(threadId: string) {
  return `${DESIGN_AUTO_OPEN_STORAGE_PREFIX}${threadId.trim()}`;
}

export function hasDesignBoardAutoOpened(threadId: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) {
    return false;
  }

  try {
    return window.sessionStorage.getItem(getAutoOpenStorageKey(threadId)) === "1";
  } catch {
    return false;
  }
}

export function buildDesignBoardChannelName(
  session: Pick<DesignBoardSession, "thread_id" | "target_path">,
): string {
  return `${DESIGN_REMOTE_CHANNEL_PREFIX}:${encodeURIComponent(session.thread_id)}:${encodeURIComponent(session.target_path)}`;
}

export function publishDesignBoardRemoteMessage(
  session: Pick<
    DesignBoardSession,
    "thread_id" | "session_id" | "session_generation" | "target_path"
  >,
  message: Pick<DesignBoardRemoteMessage, "type" | "revision">,
): void {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return;
  }

  const channel = new BroadcastChannel(buildDesignBoardChannelName(session));
  try {
    channel.postMessage({
      type: message.type,
      threadId: session.thread_id,
      sessionId: session.session_id,
      sessionGeneration: session.session_generation,
      targetPath: session.target_path,
      revision: message.revision,
      emittedAt: new Date().toISOString(),
    } satisfies DesignBoardRemoteMessage);
  } finally {
    channel.close();
  }
}

export function markDesignBoardAutoOpened(threadId: string): void {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) {
    return;
  }

  try {
    window.sessionStorage.setItem(getAutoOpenStorageKey(threadId), "1");
  } catch {
    // Session storage is only a best-effort UX hint.
  }
}

export function clearDesignBoardAutoOpened(threadId: string): void {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) {
    return;
  }

  try {
    window.sessionStorage.removeItem(getAutoOpenStorageKey(threadId));
  } catch {
    // Ignore storage cleanup failures and fall back to another auto-open miss.
  }
}
