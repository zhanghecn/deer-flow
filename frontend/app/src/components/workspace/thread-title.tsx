import type { BaseStream } from "@langchain/langgraph-sdk";
import { useEffect, useMemo, useRef } from "react";

import { useI18n } from "@/core/i18n/hooks";
import type { AgentThreadState } from "@/core/threads";
import { useRenameThread } from "@/core/threads/query-hooks";
import { buildFallbackThreadTitleFromMessages } from "@/core/threads/utils";
import { cn } from "@/lib/utils";

import { useThreadChat } from "./chats";
import { FlipDisplay } from "./flip-display";

export function ThreadTitle({
  className,
  threadId,
  thread,
}: {
  className?: string;
  threadId: string;
  thread: BaseStream<AgentThreadState>;
}) {
  const { t } = useI18n();
  const { isNewThread } = useThreadChat();
  const { mutate: renameThread, isPending: isRenamingThread } =
    useRenameThread();
  const persistedFallbackRef = useRef<string | null>(null);
  const explicitTitle = thread.values?.title?.trim() ?? "";
  const fallbackTitle = useMemo(
    () => buildFallbackThreadTitleFromMessages(thread.values?.messages),
    [thread.values?.messages],
  );
  const visibleTitle = explicitTitle || fallbackTitle;

  useEffect(() => {
    const pageTitle = isNewThread
      ? t.pages.newChat
      : visibleTitle && visibleTitle !== "Untitled"
        ? visibleTitle
        : t.pages.untitled;
    if (thread.isThreadLoading) {
      document.title = `Loading... - ${t.pages.appName}`;
    } else {
      document.title = `${pageTitle} - ${t.pages.appName}`;
    }
  }, [
    isNewThread,
    t.pages.newChat,
    t.pages.untitled,
    t.pages.appName,
    thread.isThreadLoading,
    visibleTitle,
  ]);

  useEffect(() => {
    if (
      isNewThread ||
      threadId === "new" ||
      thread.isLoading ||
      thread.isThreadLoading ||
      explicitTitle ||
      !fallbackTitle ||
      isRenamingThread
    ) {
      return;
    }

    const persistenceKey = `${threadId}:${fallbackTitle}`;
    if (persistedFallbackRef.current === persistenceKey) {
      return;
    }

    // Older threads can predate runtime title persistence. Once full state is
    // loaded, backfill the same first-turn title so the sidebar search list no
    // longer falls back to `Untitled` after refresh.
    persistedFallbackRef.current = persistenceKey;
    renameThread(
      { threadId, title: fallbackTitle },
      {
        onError: () => {
          persistedFallbackRef.current = null;
        },
      },
    );
  }, [
    explicitTitle,
    fallbackTitle,
    isNewThread,
    isRenamingThread,
    renameThread,
    thread.isLoading,
    thread.isThreadLoading,
    threadId,
  ]);

  if (!visibleTitle) {
    return null;
  }

  return (
    <FlipDisplay uniqueKey={threadId} className={cn("min-w-0", className)}>
      <div className="truncate" title={visibleTitle}>
        {visibleTitle}
      </div>
    </FlipDisplay>
  );
}
