"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

import {
  PromptInputProvider,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { InputBox } from "@/components/workspace/input-box";
import { Welcome } from "@/components/workspace/welcome";
import { useI18n } from "@/core/i18n/hooks";
import { useLocalSettings } from "@/core/settings";
import { env } from "@/env";
import { cn } from "@/lib/utils";

const NewChatSender = dynamic(
  () => import("@/components/workspace/chats/new-chat-sender"),
  { ssr: false },
);

export default function NewChatClient() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [settings, setSettings] = useLocalSettings();
  const [pendingMessage, setPendingMessage] = useState<PromptInputMessage | null>(
    null,
  );
  const isMock = searchParams.get("mock") === "true";

  const inputInitialValue = (() => {
    if (searchParams.get("mode") !== "skill") {
      return undefined;
    }
    return t.inputBox.createSkillPrompt;
  })();

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      setPendingMessage(message);
    },
    [],
  );

  if (pendingMessage) {
    return (
      <NewChatSender
        message={pendingMessage}
        context={settings.context}
        isMock={isMock}
        onError={() => setPendingMessage(null)}
        onStartedThread={(threadId) => {
          router.replace(
            isMock
              ? `/workspace/chats/${threadId}?mock=true`
              : `/workspace/chats/${threadId}`,
          );
        }}
      />
    );
  }

  return (
    <PromptInputProvider>
      <div className="relative flex size-full min-h-0 justify-between">
        <main className="flex min-h-0 max-w-full grow flex-col">
          <div className="absolute right-0 bottom-0 left-0 z-30 flex justify-center px-4">
            <div className="relative w-full -translate-y-[calc(50vh-96px)] max-w-(--container-width-sm)">
              <InputBox
                className={cn("bg-background/5 w-full -translate-y-4")}
                isNewThread
                autoFocus
                status="ready"
                context={settings.context}
                initialValue={inputInitialValue}
                extraHeader={<Welcome mode={settings.context.mode} />}
                disabled={env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true"}
                onContextChange={(context) => setSettings("context", context)}
                onSubmit={handleSubmit}
              />
              {env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" && (
                <div className="text-muted-foreground/67 w-full translate-y-12 text-center text-xs">
                  {t.common.notAvailableInDemoMode}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </PromptInputProvider>
  );
}
