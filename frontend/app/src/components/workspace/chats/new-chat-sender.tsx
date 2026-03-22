import { useEffect, useRef } from "react";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
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

  const notifyStartedThread = (resolvedThreadId: string) => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    onStartedThread(resolvedThreadId);
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
