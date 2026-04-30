import { lazy } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { type PromptInputMessage } from "@/components/ai-elements/prompt-input";
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
import { getAPIClient } from "@/core/api";
import { useI18n } from "@/core/i18n/hooks";
import { findAvailableModelName } from "@/core/models";
import { useModels } from "@/core/models/hooks";
import { useLocalSettings } from "@/core/settings";
import { env } from "@/env";
import { cn } from "@/lib/utils";

const NewChatSender = lazy(
  () => import("@/components/workspace/chats/new-chat-sender"),
);

const LEAD_AGENT_ID = "lead_agent";

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
  const draftRuntimeIdentity = useMemo(
    () => ({
      agent_name:
        typeof runtimeContext.agent_name === "string"
          ? runtimeContext.agent_name
          : undefined,
      agent_status:
        runtimeContext.agent_status === "prod"
          ? ("prod" as const)
          : runtimeContext.agent_status === "dev"
            ? ("dev" as const)
            : undefined,
      execution_backend:
        runtimeContext.execution_backend === "remote"
          ? ("remote" as const)
          : undefined,
      remote_session_id:
        typeof runtimeContext.remote_session_id === "string"
          ? runtimeContext.remote_session_id
          : undefined,
      model_name:
        typeof runtimeContext.model_name === "string"
          ? runtimeContext.model_name
          : undefined,
    }),
    [
      runtimeContext.agent_name,
      runtimeContext.agent_status,
      runtimeContext.execution_backend,
      runtimeContext.model_name,
      runtimeContext.remote_session_id,
    ],
  );
  const selectedModelName =
    typeof runtimeContext.model_name === "string"
      ? runtimeContext.model_name.trim()
      : "";
  const autoSubmitHandledRef = useRef(false);
  const ensuredDraftThreadRef = useRef<{
    threadId: string;
    promise: Promise<void>;
  } | null>(null);
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
  const handleContextChange = useCallback(
    (context: typeof settings.context) => {
      setSettings("context", context);
    },
    [setSettings],
  );

  const ensureDraftThreadExists = useCallback(async () => {
    if (!draftThreadId) {
      return;
    }

    const existing = ensuredDraftThreadRef.current;
    if (existing?.threadId === draftThreadId) {
      await existing.promise;
      return;
    }

    const promise = getAPIClient(
      isMock,
      draftThreadId,
      draftRuntimeIdentity,
    ).threads
      .create({
        threadId: draftThreadId,
        ifExists: "do_nothing",
        graphId: LEAD_AGENT_ID,
      })
      .then(() => undefined)
      .catch((error) => {
        if (ensuredDraftThreadRef.current?.threadId === draftThreadId) {
          ensuredDraftThreadRef.current = null;
        }
        throw error;
      });

    ensuredDraftThreadRef.current = {
      threadId: draftThreadId,
      promise,
    };
    await promise;
  }, [draftRuntimeIdentity, draftThreadId, isMock]);

  useEffect(() => {
    if (ensuredDraftThreadRef.current?.threadId === draftThreadId) {
      return;
    }
    ensuredDraftThreadRef.current = null;
  }, [draftThreadId]);

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
    <div className="relative flex size-full min-h-0 justify-between">
      <main className="flex min-h-0 max-w-full grow flex-col items-center">
        {/* Agent switcher — positioned top-right, compact */}
        <div className="absolute top-4 right-4 z-30">
          <AgentSwitcherDialog selection={runtimeSelection} compact />
        </div>

        {/* Centered content: welcome above, input below */}
        <div className="flex w-full max-w-(--container-width-sm) flex-1 flex-col items-center justify-center px-4 pb-8">
          <div className="w-full">
            <Welcome mode={runtimeContext.mode} />
          </div>

          {/* Input box anchored near bottom-center */}
          <div className="relative mt-8 w-full">
            <InputBox
              className={cn("w-full")}
              threadId={draftThreadId}
              isNewThread
              autoFocus
              status="ready"
              context={runtimeContext}
              initialValue={inputInitialValue}
              disabled={env.VITE_STATIC_WEBSITE_ONLY === "true"}
              onContextChange={handleContextChange}
              ensureThreadExists={ensureDraftThreadExists}
              onSubmit={handleSubmit}
            />
            {env.VITE_STATIC_WEBSITE_ONLY === "true" && (
              <div className="text-muted-foreground/50 mt-3 w-full text-center text-xs">
                {t.common.notAvailableInDemoMode}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
