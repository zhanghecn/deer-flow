import { useEffect, useRef } from "react";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import type { LocalSettings } from "@/core/settings";
import { useThreadStream } from "@/core/threads/hooks";

const activeThreadSubmissions = new Set<string>();
const DEFAULT_SUBMISSION_ERROR = "Failed to start conversation.";

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

function formatSubmissionError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return DEFAULT_SUBMISSION_ERROR;
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
  onError: (message: string) => void;
}) {
  const startedRef = useRef(false);

  const notifyStartedThread = (resolvedThreadId: string) => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    // Knowledge bases are attached directly to the preallocated draft thread,
    // so the sender no longer needs a second "persist selected knowledge"
    // branch during the first run.
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
      (error) => {
        if (!startedRef.current) {
          // Pre-stream failures, such as a missing model, never reach the
          // thread page error boundary. Surface them on the new-chat screen.
          onError(formatSubmissionError(error));
        }
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
