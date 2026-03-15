"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  PromptInputProvider,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { InputBox } from "@/components/workspace/input-box";
import { Welcome } from "@/components/workspace/welcome";
import {
  buildWorkspaceAgentPath,
  readAgentRuntimeSelection,
} from "@/core/agents";
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
  const [pendingExtraContext, setPendingExtraContext] = useState<
    Record<string, unknown> | undefined
  >(undefined);
  const isMock = searchParams.get("mock") === "true";
  const runtimeSelection = useMemo(
    () => readAgentRuntimeSelection(searchParams),
    [searchParams],
  );
  const runtimeContext = useMemo(
    () => ({
      ...settings.context,
      agent_name: runtimeSelection.agentName,
      agent_status: runtimeSelection.agentStatus,
      execution_backend: runtimeSelection.executionBackend,
      remote_session_id: runtimeSelection.remoteSessionId || undefined,
    }),
    [runtimeSelection, settings.context],
  );

  const inputInitialValue = (() => {
    if (searchParams.get("mode") !== "skill") {
      return undefined;
    }
    return "/create-skill ";
  })();

  const handleSubmit = useCallback(
    (message: PromptInputMessage, extraContext?: Record<string, unknown>) => {
      setPendingMessage(message);
      setPendingExtraContext(extraContext);
    },
    [],
  );

  useEffect(() => {
    setSettings("context", {
      agent_name: runtimeSelection.agentName,
      agent_status: runtimeSelection.agentStatus,
      execution_backend: runtimeSelection.executionBackend,
      remote_session_id: runtimeSelection.remoteSessionId || undefined,
    });
  }, [
    runtimeSelection.agentName,
    runtimeSelection.agentStatus,
    runtimeSelection.executionBackend,
    runtimeSelection.remoteSessionId,
    setSettings,
  ]);

  const buildStartedThreadPath = useCallback(
    (threadId: string) => {
      const basePath = buildWorkspaceAgentPath(
        {
          agentName: runtimeSelection.agentName,
          agentStatus: runtimeSelection.agentStatus,
          executionBackend: runtimeSelection.executionBackend,
          remoteSessionId: runtimeSelection.remoteSessionId,
        },
        threadId,
      );

      if (!isMock) {
        return basePath;
      }

      const separator = basePath.includes("?") ? "&" : "?";
      return `${basePath}${separator}mock=true`;
    },
    [
      isMock,
      runtimeSelection.agentName,
      runtimeSelection.agentStatus,
      runtimeSelection.executionBackend,
      runtimeSelection.remoteSessionId,
    ],
  );

  if (pendingMessage) {
    return (
      <NewChatSender
        message={pendingMessage}
        extraContext={pendingExtraContext}
        context={runtimeContext}
        isMock={isMock}
        onError={() => {
          setPendingMessage(null);
          setPendingExtraContext(undefined);
        }}
        onStartedThread={(threadId) => {
          router.replace(buildStartedThreadPath(threadId));
        }}
      />
    );
  }

  return (
    <PromptInputProvider initialInput={inputInitialValue}>
      <div className="relative flex size-full min-h-0 justify-between">
        <main className="flex min-h-0 max-w-full grow flex-col">
          <div className="absolute right-0 bottom-0 left-0 z-30 flex justify-center px-4">
            <div className="relative w-full -translate-y-[calc(50vh-96px)] max-w-(--container-width-sm)">
              <InputBox
                className={cn("bg-background/5 w-full -translate-y-4")}
                isNewThread
                autoFocus
                status="ready"
                context={runtimeContext}
                initialValue={inputInitialValue}
                extraHeader={
                  <div className="mx-auto w-full max-w-(--container-width-md) px-2">
                    <Welcome mode={runtimeContext.mode} />
                  </div>
                }
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
