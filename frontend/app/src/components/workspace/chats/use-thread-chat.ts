import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";

import { uuid } from "@/core/utils/uuid";

const DRAFT_THREAD_STORAGE_PREFIX = "openagents:draft-thread:";
const draftThreadCache = new Map<string, string>();

function isNewThreadPath(
  pathname: string,
  threadIdFromPath: string | undefined,
) {
  return pathname.endsWith("/new") || threadIdFromPath === "new";
}

function isChatRoutePath(pathname: string) {
  return pathname.includes("/chats/");
}

function stripKnowledgeSuffix(pathname: string) {
  return pathname.endsWith("/knowledge")
    ? pathname.slice(0, -"/knowledge".length)
    : pathname;
}

function resolveDraftThreadPath(
  pathname: string,
  threadIdFromPath: string | undefined,
) {
  const basePath = stripKnowledgeSuffix(pathname);
  if (!isChatRoutePath(basePath)) {
    return null;
  }

  if (basePath.endsWith("/new")) {
    return basePath;
  }

  if (!threadIdFromPath || threadIdFromPath === "new") {
    return null;
  }

  const threadSuffix = `/${threadIdFromPath}`;
  if (!basePath.endsWith(threadSuffix)) {
    return null;
  }

  return `${basePath.slice(0, -threadSuffix.length)}/new`;
}

function draftThreadStorageKey(pathname: string) {
  return `${DRAFT_THREAD_STORAGE_PREFIX}${pathname}`;
}

function readDraftThreadId(pathname: string) {
  const storageKey = draftThreadStorageKey(pathname);
  const cached = draftThreadCache.get(storageKey);
  if (cached) {
    return cached;
  }

  if (typeof window === "undefined") {
    return null;
  }

  const stored = window.sessionStorage.getItem(storageKey);
  if (!stored) {
    return null;
  }

  draftThreadCache.set(storageKey, stored);
  return stored;
}

function writeDraftThreadId(pathname: string, threadId: string) {
  const storageKey = draftThreadStorageKey(pathname);
  draftThreadCache.set(storageKey, threadId);
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(storageKey, threadId);
  }
}

export function clearDraftThreadId(pathname: string) {
  const storageKey = draftThreadStorageKey(pathname);
  draftThreadCache.delete(storageKey);
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(storageKey);
  }
}

function getOrCreateDraftThreadId(pathname: string) {
  const existing = readDraftThreadId(pathname);
  if (existing) {
    return existing;
  }

  const nextThreadId = uuid();
  writeDraftThreadId(pathname, nextThreadId);
  return nextThreadId;
}

export function resolveThreadRouteIdentity(
  pathname: string,
  threadIdFromPath: string | undefined,
) {
  const draftThreadPath = resolveDraftThreadPath(pathname, threadIdFromPath);
  if (!isChatRoutePath(pathname)) {
    return {
      threadId: undefined,
      isNewThread: false,
      draftThreadPath: null,
    };
  }

  if (isNewThreadPath(pathname, threadIdFromPath)) {
    return {
      threadId: getOrCreateDraftThreadId(draftThreadPath ?? pathname),
      isNewThread: true,
      draftThreadPath,
    };
  }

  return {
    threadId: threadIdFromPath,
    isNewThread: false,
    draftThreadPath,
  };
}

export function useThreadChat() {
  const { thread_id: threadIdFromPath } = useParams<{ thread_id: string }>();
  const pathname = useLocation().pathname;
  const routeIdentity = useMemo(
    () => resolveThreadRouteIdentity(pathname, threadIdFromPath),
    [pathname, threadIdFromPath],
  );

  const [searchParams] = useSearchParams();
  const [threadId, setThreadId] = useState(() => routeIdentity.threadId ?? "");
  const [isNewThread, setIsNewThread] = useState(
    () => routeIdentity.isNewThread,
  );
  const lastDraftPathRef = useRef<string | null>(routeIdentity.draftThreadPath);
  // Existing-thread routes must reflect the URL immediately. If we expose the
  // old state for one render after a sidebar click, thread-runtime effects can
  // navigate back to the previous conversation before the sync effect runs.
  const visibleThreadId = routeIdentity.isNewThread
    ? threadId
    : (routeIdentity.threadId ?? threadId);

  // Sync threadId when route params change (React Router doesn't remount on param change)
  useEffect(() => {
    if (routeIdentity.isNewThread) {
      lastDraftPathRef.current = routeIdentity.draftThreadPath;
      if (!isNewThread) {
        setThreadId(routeIdentity.threadId ?? "");
        setIsNewThread(true);
        return;
      }

      if (routeIdentity.threadId && threadId !== routeIdentity.threadId) {
        setThreadId(routeIdentity.threadId);
      }
      return;
    }

    const staleDraftPath =
      lastDraftPathRef.current ?? routeIdentity.draftThreadPath;
    if (staleDraftPath) {
      clearDraftThreadId(staleDraftPath);
      lastDraftPathRef.current = null;
    }

    if (isNewThread) {
      setIsNewThread(false);
    }

    if (routeIdentity.threadId && threadId !== routeIdentity.threadId) {
      setThreadId(routeIdentity.threadId);
    }
  }, [isNewThread, routeIdentity, threadId]);

  const isMock = searchParams.get("mock") === "true";
  return {
    threadId: visibleThreadId,
    setThreadId,
    isNewThread,
    setIsNewThread,
    isMock,
  };
}
