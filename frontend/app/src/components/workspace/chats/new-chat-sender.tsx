"use client";

import { useEffect, useMemo, useRef } from "react";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import type { LocalSettings } from "@/core/settings";
import { useThreadStream } from "@/core/threads/hooks";
import { uuid } from "@/core/utils/uuid";

export default function NewChatSender({
  message,
  context,
  isMock,
  onStartedThread,
  onError,
}: {
  message: PromptInputMessage;
  context: LocalSettings["context"];
  isMock: boolean;
  onStartedThread: (threadId: string) => void;
  onError: () => void;
}) {
  const threadId = useMemo(() => uuid(), []);
  const sentRef = useRef(false);

  const [, sendMessage] = useThreadStream({
    context,
    isMock,
    onStart: onStartedThread,
  });

  useEffect(() => {
    if (sentRef.current) {
      return;
    }
    sentRef.current = true;
    void sendMessage(threadId, message).catch(() => {
      sentRef.current = false;
      onError();
    });
  }, [message, onError, sendMessage, threadId]);

  return (
    <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
      Creating conversation...
    </div>
  );
}
