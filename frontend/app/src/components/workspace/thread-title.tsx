import type { BaseStream } from "@langchain/langgraph-sdk";
import { useEffect } from "react";

import { useI18n } from "@/core/i18n/hooks";
import type { AgentThreadState } from "@/core/threads";
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
  useEffect(() => {
    const pageTitle = isNewThread
      ? t.pages.newChat
      : thread.values?.title && thread.values.title !== "Untitled"
        ? thread.values.title
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
    thread.values?.title,
  ]);

  if (!thread.values?.title) {
    return null;
  }

  const visibleTitle = thread.values.title ?? "Untitled";

  return (
    <FlipDisplay uniqueKey={threadId} className={cn("min-w-0", className)}>
      <div className="truncate" title={visibleTitle}>
        {visibleTitle}
      </div>
    </FlipDisplay>
  );
}
