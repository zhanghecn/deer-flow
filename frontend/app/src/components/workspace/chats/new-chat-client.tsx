import { lazy } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import {
  PromptInputProvider,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { AgentSwitcherDialog } from "@/components/workspace/agent-switcher-dialog";
import { useThreadChat } from "@/components/workspace/chats/use-thread-chat";
import { InputBox } from "@/components/workspace/input-box";
import { Welcome } from "@/components/workspace/welcome";
import {
  buildWorkspaceAgentPath,
  isLeadAgent,
  readAgentRuntimeSelection,
  useAgent,
} from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";
import { useModels } from "@/core/models/hooks";
import { findAvailableModelName } from "@/core/models";
import { useLocalSettings } from "@/core/settings";
import { env } from "@/env";
import { cn } from "@/lib/utils";

const NewChatSender = lazy(
  () => import("@/components/workspace/chats/new-chat-sender"),
);

export default function NewChatClient() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const routeParams = useParams<{ agent_name?: string }>();
  const [settings, setSettings] = useLocalSettings();
  const { models } = useModels();
  const [pendingMessage, setPendingMessage] =
    useState<PromptInputMessage | null>(null);
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null);
  const [pendingExtraContext, setPendingExtraContext] = useState<
    Record<string, unknown> | undefined
  >(undefined);
  const { threadId: draftThreadId } = useThreadChat();
  const isMock = searchParams.get("mock") === "true";
  const runtimeSelection = useMemo(
    () => readAgentRuntimeSelection(searchParams, routeParams.agent_name),
    [routeParams.agent_name, searchParams],
  );
  const isCustomAgent = !isLeadAgent(runtimeSelection.agentName);
  const { agent } = useAgent(
    isCustomAgent ? runtimeSelection.agentName : null,
    runtimeSelection.agentStatus,
  );
  const defaultModelName = models[0]?.name;
  const configuredModelName = useMemo(
    () => findAvailableModelName(models, settings.context.model_name),
    [models, settings.context.model_name],
  );
  const pinnedModelName = useMemo(() => {
    const modelName = agent?.model?.trim();
    return modelName === "" ? undefined : modelName;
  }, [agent?.model]);
  const runtimeContext = useMemo(
    () => ({
      ...settings.context,
      agent_name: runtimeSelection.agentName,
      agent_status: runtimeSelection.agentStatus,
      execution_backend: runtimeSelection.executionBackend,
      remote_session_id: runtimeSelection.remoteSessionId ?? undefined,
      model_name:
        pinnedModelName ??
        (isCustomAgent ? undefined : (configuredModelName ?? defaultModelName)),
    }),
    [
      configuredModelName,
      defaultModelName,
      isCustomAgent,
      pinnedModelName,
      runtimeSelection,
      settings.context,
    ],
  );
  const selectedModelName =
    typeof runtimeContext.model_name === "string"
      ? runtimeContext.model_name.trim()
      : "";
  const autoSubmitHandledRef = useRef(false);
  const inputInitialValue = useMemo(() => {
    const prefill = searchParams.get("prefill")?.trim();
    if (prefill) {
      return prefill;
    }
    if (searchParams.get("mode") === "skill") {
      return "/create-skill ";
    }
    return undefined;
  }, [searchParams]);

  const handleSubmit = useCallback(
    (message: PromptInputMessage, extraContext?: Record<string, unknown>) => {
      setPendingThreadId(draftThreadId);
      setPendingMessage(message);
      setPendingExtraContext(extraContext);
    },
    [draftThreadId],
  );

  useEffect(() => {
    if (pinnedModelName) {
      if (settings.context.model_name === pinnedModelName) {
        return;
      }
      setSettings("context", {
        model_name: pinnedModelName,
      });
      return;
    }

    if (isCustomAgent || configuredModelName || !defaultModelName) {
      return;
    }

    setSettings("context", {
      model_name: defaultModelName,
    });
  }, [
    configuredModelName,
    defaultModelName,
    isCustomAgent,
    pinnedModelName,
    setSettings,
    settings.context.model_name,
  ]);

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

  useEffect(() => {
    if (
      autoSubmitHandledRef.current ||
      searchParams.get("autosend") !== "1" ||
      !inputInitialValue?.trim() ||
      !selectedModelName
    ) {
      return;
    }

    autoSubmitHandledRef.current = true;
    handleSubmit(
      {
        text: inputInitialValue,
        files: [],
      },
      undefined,
    );
  }, [handleSubmit, inputInitialValue, searchParams, selectedModelName]);

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
      const [pathname = basePath, search = ""] = basePath.split("?", 2);
      const params = new URLSearchParams(search);
      params.set("pending_run", "1");
      const pendingPath = `${pathname}?${params.toString()}`;

      if (!isMock) {
        return pendingPath;
      }

      return `${pendingPath}&mock=true`;
    },
    [
      isMock,
      runtimeSelection.agentName,
      runtimeSelection.agentStatus,
      runtimeSelection.executionBackend,
      runtimeSelection.remoteSessionId,
    ],
  );

  if (pendingMessage && pendingThreadId) {
    return (
      <NewChatSender
        threadId={pendingThreadId}
        message={pendingMessage}
        extraContext={pendingExtraContext}
        context={runtimeContext}
        isMock={isMock}
        onError={() => {
          setPendingThreadId(null);
          setPendingMessage(null);
          setPendingExtraContext(undefined);
        }}
        onStartedThread={(threadId) => {
          void navigate(buildStartedThreadPath(threadId), { replace: true });
        }}
      />
    );
  }

  return (
    <PromptInputProvider initialInput={inputInitialValue}>
      <div className="relative flex size-full min-h-0 justify-between">
        <main className="flex min-h-0 max-w-full grow flex-col">
          <div className="absolute top-4 right-4 z-30">
            <AgentSwitcherDialog selection={runtimeSelection} compact />
          </div>
          <div className="pointer-events-none absolute right-0 bottom-0 left-0 z-30 flex justify-center px-4">
            <div className="pointer-events-auto relative w-full max-w-(--container-width-sm) -translate-y-[calc(50vh-96px)]">
              <InputBox
                className={cn("bg-background/5 w-full -translate-y-4")}
                threadId={draftThreadId}
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
                disabled={env.VITE_STATIC_WEBSITE_ONLY === "true"}
                onContextChange={(context) => setSettings("context", context)}
                onSubmit={handleSubmit}
              />
              {env.VITE_STATIC_WEBSITE_ONLY === "true" && (
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
