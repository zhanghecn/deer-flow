import type { Command } from "@langchain/langgraph-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useParams,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { AgentWelcome } from "@/components/workspace/agent-welcome";
import { ChatBox } from "@/components/workspace/chats/chat-box";
import { shouldShowCenteredComposer } from "@/components/workspace/chats/layout-state";
import { useDockPadding } from "@/components/workspace/chats/use-dock-padding";
import { useThreadChat } from "@/components/workspace/chats/use-thread-chat";
import { InputBox } from "@/components/workspace/input-box";
import { ThreadContext } from "@/components/workspace/messages/context";
import { MessageList } from "@/components/workspace/messages/message-list";
import { QuestionDock } from "@/components/workspace/messages/question-dock";
import { ThreadChatHeader } from "@/components/workspace/thread-chat-header";
import { TodoList } from "@/components/workspace/todo-list";
import {
  readAgentRuntimeSelection,
  type ResolvedAgentRuntimeSelection,
  useAgent,
} from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";
import { findAvailableModelName } from "@/core/models";
import { useModels } from "@/core/models/hooks";
import { useNotification } from "@/core/notification/hooks";
import { useLocalSettings } from "@/core/settings";
import { useThreadStream } from "@/core/threads/hooks";
import { useThreadRuntime } from "@/core/threads/query-hooks";
import {
  buildCurrentPath,
  buildThreadCompletionNotificationBody,
  buildThreadPath,
  buildThreadRuntimeContext,
  didThreadRuntimeSelectionChange,
  resolveThreadRuntimeBinding,
} from "@/core/threads/utils";
import { env } from "@/env";
import { cn } from "@/lib/utils";

export default function AgentChatPage() {
  const { t } = useI18n();
  const location = useLocation();
  const pathname = location.pathname;
  const [settings, setSettings] = useLocalSettings();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { models } = useModels();
  const defaultModelName = models[0]?.name;
  const configuredModelName = useMemo(
    () => findAvailableModelName(models, settings.context.model_name),
    [models, settings.context.model_name],
  );
  const routeHasPendingRun = searchParams.get("pending_run") === "1";
  const [isPendingRun, setIsPendingRun] = useState(routeHasPendingRun);

  useEffect(() => {
    setIsPendingRun(routeHasPendingRun);
  }, [routeHasPendingRun]);

  const { agent_name } = useParams();
  const routeRuntimeSelection = useMemo(
    () => readAgentRuntimeSelection(searchParams, agent_name),
    [agent_name, searchParams],
  );
  const { threadId, setThreadId, isNewThread, isMock } = useThreadChat();
  const { data: threadRuntime, isLoading: threadRuntimeLoading } =
    useThreadRuntime(isMock || isNewThread || isPendingRun ? null : threadId);
  const boundThreadRuntime = useMemo(
    () => resolveThreadRuntimeBinding(threadRuntime),
    [threadRuntime],
  );
  const runtimeSelection = useMemo<ResolvedAgentRuntimeSelection>(
    () =>
      threadRuntime
        ? {
            agentName: boundThreadRuntime.agentName,
            agentStatus: boundThreadRuntime.agentStatus,
            executionBackend: boundThreadRuntime.executionBackend,
            remoteSessionId: boundThreadRuntime.remoteSessionId ?? "",
          }
        : routeRuntimeSelection,
    [boundThreadRuntime, routeRuntimeSelection, threadRuntime],
  );
  const runtimeMessageContext = useMemo(
    () => buildThreadRuntimeContext(runtimeSelection),
    [runtimeSelection],
  );
  const selectedAgentName =
    runtimeSelection.agentName === "lead_agent"
      ? null
      : runtimeSelection.agentName;
  const { agent } = useAgent(selectedAgentName, runtimeSelection.agentStatus);
  const trimmedAgentModelName = agent?.model?.trim();
  const runtimeContextSeed = useMemo(
    () => ({
      ...settings.context,
      ...runtimeMessageContext,
      model_name:
        boundThreadRuntime.modelName ??
        (trimmedAgentModelName && trimmedAgentModelName.length > 0
          ? trimmedAgentModelName
          : selectedAgentName
            ? undefined
            : (configuredModelName ?? defaultModelName)),
    }),
    [
      boundThreadRuntime.modelName,
      configuredModelName,
      defaultModelName,
      runtimeMessageContext,
      selectedAgentName,
      settings.context,
      trimmedAgentModelName,
    ],
  );
  const [runtimeContext, setRuntimeContext] =
    useState<typeof settings.context>(runtimeContextSeed);
  const { dockRef, paddingBottom } = useDockPadding();
  const autoSubmitHandledRef = useRef(false);
  const inputInitialValue = useMemo(() => {
    const prefill = searchParams.get("prefill")?.trim();
    if (prefill) {
      return prefill;
    }

    if (searchParams.get("mode") === "skill") {
      return t.inputBox.createSkillPrompt;
    }

    return undefined;
  }, [searchParams, t.inputBox.createSkillPrompt]);
  const selectedModelName =
    typeof runtimeContext.model_name === "string"
      ? runtimeContext.model_name.trim()
      : "";

  useEffect(() => {
    if (selectedAgentName) {
      if (!trimmedAgentModelName) {
        return;
      }

      if (settings.context.model_name === trimmedAgentModelName) {
        return;
      }

      setSettings("context", {
        model_name: trimmedAgentModelName,
      });
      return;
    }

    if (configuredModelName || !defaultModelName) {
      return;
    }

    setSettings("context", {
      model_name: defaultModelName,
    });
  }, [
    configuredModelName,
    defaultModelName,
    selectedAgentName,
    setSettings,
    settings.context.model_name,
    trimmedAgentModelName,
  ]);

  useEffect(() => {
    setRuntimeContext(runtimeContextSeed);
  }, [runtimeContextSeed]);

  const { showNotification } = useNotification();
  const clearPendingRun = useCallback(() => {
    setIsPendingRun(false);
    const nextPath = buildThreadPath(runtimeSelection, threadId, { isMock });
    const currentPath = buildCurrentPath(pathname, searchParams);
    if (nextPath !== currentPath) {
      void navigate(nextPath, { replace: true });
    }
  }, [isMock, navigate, pathname, runtimeSelection, searchParams, threadId]);

  useEffect(() => {
    // Route changes can briefly overlap with the previous thread state. Only
    // rewrite the URL when the fetched runtime binding belongs to the thread
    // currently shown in the route.
    if (!threadRuntime || isNewThread || threadRuntime.thread_id !== threadId) {
      return;
    }

    if (
      !didThreadRuntimeSelectionChange(routeRuntimeSelection, runtimeSelection)
    ) {
      return;
    }

    const nextPath = buildThreadPath(runtimeSelection, threadId, {
      isMock,
      isPendingRun,
    });
    const currentPath = buildCurrentPath(pathname, searchParams);
    if (nextPath !== currentPath) {
      void navigate(nextPath, { replace: true });
    }
  }, [
    isPendingRun,
    isMock,
    isNewThread,
    pathname,
    routeRuntimeSelection,
    runtimeSelection,
    searchParams,
    threadId,
    threadRuntime,
  ]);

  const [thread, sendMessage, resumeInterrupt, , executionStatus] = useThreadStream(
    {
      threadId,
      context: runtimeContext,
      skipInitialHistory: isNewThread || isPendingRun,
      onStart: (createdThreadId) => {
        setIsPendingRun(true);
        setThreadId(createdThreadId);
        void navigate(
          buildThreadPath(runtimeSelection, createdThreadId, {
            isMock,
            isPendingRun: true,
          }),
          { replace: true },
        );
      },
      onFinish: (state) => {
        clearPendingRun();
        if (document.hidden || !document.hasFocus()) {
          showNotification(state.title, {
            body: buildThreadCompletionNotificationBody(state),
          });
        }
      },
      onStop: () => {
        clearPendingRun();
      },
    },
  );

  const handleSendMessage = useCallback(
    async (
      message: PromptInputMessage,
      extraContext?: Record<string, unknown>,
    ) => {
      await sendMessage(threadId, message, {
        ...runtimeMessageContext,
        ...extraContext,
      });
    },
    [runtimeMessageContext, sendMessage, threadId],
  );
  const handleSubmit = useCallback(
    (message: PromptInputMessage, extraContext?: Record<string, unknown>) => {
      void handleSendMessage(message, extraContext);
    },
    [handleSendMessage],
  );
  const handleRuntimeContextChange = useCallback(
    (context: typeof settings.context) => {
      setRuntimeContext(context);
    },
    [],
  );

  useEffect(() => {
    if (
      !isNewThread ||
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
  }, [
    handleSubmit,
    inputInitialValue,
    isNewThread,
    searchParams,
    selectedModelName,
  ]);

  const handleResumeInterrupt = useCallback(
    async (command: Command, extraContext?: Record<string, unknown>) => {
      await resumeInterrupt(threadId, command, {
        ...runtimeMessageContext,
        ...extraContext,
      });
    },
    [runtimeMessageContext, resumeInterrupt, threadId],
  );

  const handleStop = useCallback(async () => {
    try {
      await thread.stop();
    } finally {
      clearPendingRun();
    }
  }, [clearPendingRun, thread]);

  useEffect(() => {
    if (thread.isLoading || !isPendingRun) {
      return;
    }

    const hasAssistantReply = thread.messages.some(
      (message) => message.type === "ai",
    );
    if (!hasAssistantReply) {
      return;
    }

    clearPendingRun();
  }, [clearPendingRun, isPendingRun, thread]);

  const showCenteredComposer = useMemo(
    () =>
      shouldShowCenteredComposer({
        isNewThread,
        isPendingRun,
        isThreadLoading: thread.isLoading,
        messages: thread.messages,
      }),
    [isNewThread, isPendingRun, thread.isLoading, thread.messages],
  );

  if (!isNewThread && threadRuntimeLoading && !threadRuntime) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Restoring conversation...
      </div>
    );
  }

  return (
    <ThreadContext.Provider
      value={{
        thread,
        isMock,
        sendMessage: handleSendMessage,
        resumeInterrupt: handleResumeInterrupt,
      }}
    >
      <ChatBox threadId={threadId}>
        <div className="relative flex size-full min-h-0 justify-between">
          <ThreadChatHeader
            runtimeSelection={runtimeSelection}
            showCenteredComposer={showCenteredComposer}
            thread={thread}
            threadId={threadId}
          />

          <main className="flex min-h-0 max-w-full grow flex-col">
            <div className="flex size-full justify-center">
              <MessageList
                className={cn("size-full", !showCenteredComposer && "pt-10")}
                threadId={threadId}
                thread={thread}
                executionStatus={executionStatus}
                paddingBottom={showCenteredComposer ? undefined : paddingBottom}
              />
            </div>

            <div className="absolute right-0 bottom-0 left-0 z-30 flex justify-center px-4">
              <div
                className={cn(
                  "relative w-full",
                  showCenteredComposer && "-translate-y-[calc(50vh-96px)]",
                  showCenteredComposer
                    ? "max-w-(--container-width-sm)"
                    : "max-w-(--container-width-md)",
                )}
              >
                <div className="absolute -top-4 right-0 left-0 z-0">
                  <div className="absolute right-0 bottom-0 left-0">
                    <TodoList
                      className="bg-background/5"
                      todos={thread.values.todos ?? []}
                      hidden={
                        !thread.values.todos || thread.values.todos.length === 0
                      }
                    />
                  </div>
                </div>
                <div className="space-y-3" ref={dockRef}>
                  <QuestionDock />
                  <InputBox
                    className={cn("bg-background/5 w-full -translate-y-4")}
                    threadId={threadId}
                    isNewThread={showCenteredComposer}
                    autoFocus={showCenteredComposer}
                    status={thread.isLoading ? "streaming" : "ready"}
                    context={runtimeContext}
                    executionStatus={executionStatus}
                    initialValue={inputInitialValue}
                    contextWindow={
                      showCenteredComposer
                        ? undefined
                        : thread.values.context_window
                    }
                    extraHeader={
                      showCenteredComposer && (
                        <div className="mx-auto w-full max-w-(--container-width-md) px-2">
                          <AgentWelcome
                            agent={agent}
                            agentName={runtimeSelection.agentName}
                            agentStatus={runtimeSelection.agentStatus}
                          />
                        </div>
                      )
                    }
                    disabled={env.VITE_STATIC_WEBSITE_ONLY === "true"}
                    onContextChange={handleRuntimeContextChange}
                    onSubmit={handleSubmit}
                    onStop={handleStop}
                  />
                </div>
                {env.VITE_STATIC_WEBSITE_ONLY === "true" && (
                  <div className="text-muted-foreground/67 w-full translate-y-12 text-center text-xs">
                    {t.common.notAvailableInDemoMode}
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>
      </ChatBox>
    </ThreadContext.Provider>
  );
}
