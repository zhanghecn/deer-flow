"use client";

import { MessageCircleQuestionMarkIcon } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/core/i18n/hooks";
import { extractClarificationRequestFromInterrupt } from "@/core/threads/interrupts";
import type { AgentInterrupt } from "@/core/threads/types";
import { cn } from "@/lib/utils";

import { useThread } from "./context";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForInterruptToClear({
  client,
  threadId,
  interruptId,
}: {
  client: {
    threads: {
      get: (threadId: string) => Promise<{
        interrupts?: Record<string, Array<{ id?: string }>>;
      }>;
    };
  };
  threadId: string;
  interruptId?: string;
}) {
  const deadline = Date.now() + 15000;

  while (Date.now() < deadline) {
    const currentThread = await client.threads.get(threadId);
    const pendingInterrupts = Object.values(currentThread.interrupts ?? {}).flat();
    const hasPendingInterrupt =
      pendingInterrupts.length > 0 &&
      (interruptId
        ? pendingInterrupts.some((item) => item.id === interruptId)
        : true);

    if (!hasPendingInterrupt) {
      return;
    }

    await sleep(250);
  }
}

async function submitClarificationAnswer(
  answer: string,
  actions: {
    resumeInterrupt?: (
      command: { resume: { decisions: Array<{ type: "approve" }> } },
    ) => Promise<void>;
    sendMessage?: (message: PromptInputMessage) => Promise<void>;
    waitForResolution?: () => Promise<void>;
  },
) {
  await actions.resumeInterrupt?.({
    resume: {
      decisions: [{ type: "approve" }],
    },
  });
  await actions.waitForResolution?.();

  await actions.sendMessage?.({
    text: answer,
    files: [],
  });
}

export function ClarificationInterrupt({
  className,
  interrupt,
}: {
  className?: string;
  interrupt: AgentInterrupt | undefined;
}) {
  const { t } = useI18n();
  const { sendMessage, resumeInterrupt, thread } = useThread();
  const { thread_id: threadId } = useParams<{ thread_id?: string }>();
  const [answer, setAnswer] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const clarification = extractClarificationRequestFromInterrupt(interrupt);
  if (!interrupt || !clarification) {
    return null;
  }

  const isDisabled =
    isSubmitting ||
    thread.isLoading ||
    !sendMessage ||
    !resumeInterrupt;

  const handleSubmit = async (nextAnswer: string) => {
    const trimmedAnswer = nextAnswer.trim();
    if (!trimmedAnswer || isDisabled) {
      return;
    }

    setIsSubmitting(true);
    try {
      await submitClarificationAnswer(trimmedAnswer, {
        resumeInterrupt,
        sendMessage,
        waitForResolution:
          threadId && thread.client?.threads
            ? () =>
                waitForInterruptToClear({
                  client: thread.client,
                  threadId,
                  interruptId: interrupt.id,
                })
            : undefined,
      });
      setAnswer("");
    } catch (error) {
      console.error("Failed to answer clarification:", error);
      toast.error(t.toolCalls.clarificationResumeError);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className={cn(
        "border-border/80 bg-background/95 w-full rounded-2xl border p-4 shadow-sm backdrop-blur",
        className,
      )}
    >
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <MessageCircleQuestionMarkIcon className="text-primary size-4" />
        <span>{t.toolCalls.clarificationQuestion}</span>
      </div>
      <div className="space-y-3">
        <div className="space-y-1">
          <div className="text-foreground text-sm font-medium">
            {clarification.question}
          </div>
          {clarification.context && (
            <div className="text-muted-foreground text-sm">
              <span className="font-medium">
                {t.toolCalls.clarificationContext}
                {": "}
              </span>
              {clarification.context}
            </div>
          )}
        </div>

        {clarification.options.length > 0 && (
          <div className="space-y-2">
            <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              {t.toolCalls.clarificationOptions}
            </div>
            <div className="flex flex-wrap gap-2">
              {clarification.options.map((option, index) => (
                <Button
                  key={`${option}-${index}`}
                  variant="outline"
                  size="sm"
                  disabled={isDisabled}
                  onClick={() => void handleSubmit(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder={t.toolCalls.clarificationReplyPlaceholder}
            disabled={isDisabled}
            className="min-h-24 resize-y"
          />
          <div className="flex justify-end">
            <Button
              disabled={isDisabled || answer.trim().length === 0}
              onClick={() => void handleSubmit(answer)}
            >
              {t.toolCalls.clarificationReplyAction}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
