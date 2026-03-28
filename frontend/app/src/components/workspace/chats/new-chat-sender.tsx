import { useEffect, useRef } from "react";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { attachKnowledgeBaseToThread } from "@/core/knowledge/api";
import type { LocalSettings } from "@/core/settings";
import { useThreadStream } from "@/core/threads/hooks";

const activeThreadSubmissions = new Set<string>();

function claimThreadSubmission(threadId: string) {
  if (activeThreadSubmissions.has(threadId)) {
    return false;
  }

  activeThreadSubmissions.add(threadId);
  return true;
}

function releaseThreadSubmission(threadId: string) {
  activeThreadSubmissions.delete(threadId);
}

export default function NewChatSender({
  threadId,
  message,
  extraContext,
  context,
  isMock,
  onStartedThread,
  onError,
}: {
  threadId: string;
  message: PromptInputMessage;
  extraContext?: Record<string, unknown>;
  context: LocalSettings["context"];
  isMock: boolean;
  onStartedThread: (threadId: string) => void;
  onError: () => void;
}) {
  const startedRef = useRef(false);
  const persistedThreadBindingsRef = useRef<Set<string>>(new Set());

  const persistSelectedKnowledgeBases = async (resolvedThreadId: string) => {
    if (persistedThreadBindingsRef.current.has(resolvedThreadId)) {
      return;
    }

    const selectedBaseIds = Array.isArray(extraContext?.knowledge_base_ids)
      ? extraContext.knowledge_base_ids
          .map((item) => String(item).trim())
          .filter(Boolean)
      : [];
    if (selectedBaseIds.length === 0) {
      return;
    }

    persistedThreadBindingsRef.current.add(resolvedThreadId);
    try {
      await Promise.allSettled(
        Array.from(new Set(selectedBaseIds)).map((knowledgeBaseId) =>
          attachKnowledgeBaseToThread(resolvedThreadId, knowledgeBaseId),
        ),
      );
    } catch (error) {
      console.warn(
        "Failed to persist selected knowledge bases for new thread:",
        error,
      );
    }
  };

  const notifyStartedThread = (resolvedThreadId: string) => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    void persistSelectedKnowledgeBases(resolvedThreadId).finally(() => {
      onStartedThread(resolvedThreadId);
    });
  };

  const [, sendMessage, , isThreadReady] = useThreadStream({
    threadId,
    context,
    isMock,
    skipInitialHistory: true,
    onStart: notifyStartedThread,
  });

  useEffect(() => {
    if (!isThreadReady) {
      return;
    }

    if (!claimThreadSubmission(threadId)) {
      return;
    }

    const sendPromise = sendMessage(threadId, message, extraContext).catch(
      () => {
        onError();
        releaseThreadSubmission(threadId);
      },
    );
    void sendPromise;
  }, [extraContext, isThreadReady, message, onError, sendMessage, threadId]);

  return (
    <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
      Creating conversation...
    </div>
  );
}
