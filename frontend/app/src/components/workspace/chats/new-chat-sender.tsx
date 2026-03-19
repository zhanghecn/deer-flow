"use client";

import { useEffect, useMemo, useRef } from "react";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import type { LocalSettings } from "@/core/settings";
import { useThreadStream } from "@/core/threads/hooks";
import { uuid } from "@/core/utils/uuid";

export default function NewChatSender({
  message,
  extraContext,
  context,
  isMock,
  onStartedThread,
  onError,
}: {
  message: PromptInputMessage;
  extraContext?: Record<string, unknown>;
  context: LocalSettings["context"];
  isMock: boolean;
  onStartedThread: (threadId: string) => void;
  onError: () => void;
}) {
  const threadId = useMemo(() => uuid(), []);
  const sentRef = useRef(false);

  const [, sendMessage, , isThreadReady] = useThreadStream({
    threadId,
    context,
    isMock,
    skipInitialHistory: true,
    onStart: onStartedThread,
  });

  useEffect(() => {
    if (sentRef.current || !isThreadReady) {
      return;
    }
    sentRef.current = true;
    const sendPromise = sendMessage(threadId, message, extraContext).catch(
      () => {
        sentRef.current = false;
        onError();
      },
    );
    void sendPromise;
  }, [
    extraContext,
    isThreadReady,
    message,
    onError,
    sendMessage,
    threadId,
  ]);

  return (
    <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
      Creating conversation...
    </div>
  );
}
