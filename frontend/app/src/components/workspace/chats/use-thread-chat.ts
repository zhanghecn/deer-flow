import { useEffect, useState } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";

import { uuid } from "@/core/utils/uuid";

function isNewThreadPath(
  pathname: string,
  threadIdFromPath: string | undefined,
) {
  return pathname.endsWith("/new") || threadIdFromPath === "new";
}

function createThreadId(
  pathname: string,
  threadIdFromPath: string | undefined,
) {
  if (isNewThreadPath(pathname, threadIdFromPath) || !threadIdFromPath) {
    return uuid();
  }

  return threadIdFromPath;
}

export function useThreadChat() {
  const { thread_id: threadIdFromPath } = useParams<{ thread_id: string }>();
  const pathname = useLocation().pathname;
  const isNewPath = isNewThreadPath(pathname, threadIdFromPath);

  const [searchParams] = useSearchParams();
  const [threadId, setThreadId] = useState(() =>
    createThreadId(pathname, threadIdFromPath),
  );
  const [isNewThread, setIsNewThread] = useState(() => isNewPath);

  // Sync threadId when route params change (React Router doesn't remount on param change)
  useEffect(() => {
    if (isNewPath) {
      if (!isNewThread) {
        setThreadId(uuid());
        setIsNewThread(true);
      }
      return;
    }

    if (threadIdFromPath && threadIdFromPath !== "new") {
      if (isNewThread) {
        setIsNewThread(false);
      }

      if (threadId !== threadIdFromPath) {
        setThreadId(threadIdFromPath);
      }
    }
  }, [isNewPath, isNewThread, threadId, threadIdFromPath]);

  const isMock = searchParams.get("mock") === "true";
  return { threadId, setThreadId, isNewThread, setIsNewThread, isMock };
}
