import { useEffect, useState } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";

import { uuid } from "@/core/utils/uuid";

function createThreadId(threadIdFromPath: string | undefined) {
  if (!threadIdFromPath || threadIdFromPath === "new") {
    return uuid();
  }

  return threadIdFromPath;
}

export function useThreadChat() {
  const { thread_id: threadIdFromPath } = useParams<{ thread_id: string }>();
  const pathname = useLocation().pathname;

  const [searchParams] = useSearchParams();
  const [threadId, setThreadId] = useState(() =>
    createThreadId(threadIdFromPath),
  );

  const [isNewThread, setIsNewThread] = useState(
    () => threadIdFromPath === "new",
  );

  // Sync threadId when route params change (React Router doesn't remount on param change)
  useEffect(() => {
    if (pathname.endsWith("/new")) {
      setIsNewThread(true);
      setThreadId(uuid());
      return;
    }

    if (threadIdFromPath && threadIdFromPath !== "new") {
      setIsNewThread(false);
      setThreadId(threadIdFromPath);
    }
  }, [pathname, threadIdFromPath]);

  const isMock = searchParams.get("mock") === "true";
  return { threadId, setThreadId, isNewThread, setIsNewThread, isMock };
}
