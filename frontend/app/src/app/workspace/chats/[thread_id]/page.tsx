import type { Command } from "@langchain/langgraph-sdk";
import { lazy } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { type PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { AgentSwitcherDialog } from "@/components/workspace/agent-switcher-dialog";
import { ArtifactTrigger } from "@/components/workspace/artifacts/artifact-trigger";
import { shouldShowCenteredComposer } from "@/components/workspace/chats/layout-state";
import { useSpecificChatMode } from "@/components/workspace/chats/use-chat-mode";
import { useThreadChat } from "@/components/workspace/chats/use-thread-chat";
import { InputBox } from "@/components/workspace/input-box";
import { ThreadContext } from "@/components/workspace/messages/context";
import { ThreadTitle } from "@/components/workspace/thread-title";
import { TodoList } from "@/components/workspace/todo-list";
import { Welcome } from "@/components/workspace/welcome";
import {
  readAgentRuntimeSelection,
  type ResolvedAgentRuntimeSelection,
} from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";
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

const ChatBox = lazy(() =>
  import("@/components/workspace/chats/chat-box").then((m) => ({
    default: m.ChatBox,
  })),
);
const MessageList = lazy(() =>
  import("@/components/workspace/messages/message-list").then((m) => ({
    default: m.MessageList,
  })),
);

export default function ChatPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const [settings] = useLocalSettings();
  const [searchParams] = useSearchParams();
  const routeHasPendingRun = searchParams.get("pending_run") === "1";
  const routeRuntimeSelection = useMemo(
    () => readAgentRuntimeSelection(searchParams),
    [searchParams],
  );
  const [isPendingRun, setIsPendingRun] = useState(routeHasPendingRun);

  useEffect(() => {
    setIsPendingRun(routeHasPendingRun);
  }, [routeHasPendingRun]);

  const { threadId, setThreadId, isNewThread, setIsNewThread, isMock } =
    useThreadChat();
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
  const runtimeContextSeed = useMemo(
    () => ({
      ...settings.context,
      ...runtimeMessageContext,
      model_name: boundThreadRuntime.modelName ?? settings.context.model_name,
    }),
    [boundThreadRuntime.modelName, runtimeMessageContext, settings.context],
  );
  const [runtimeContext, setRuntimeContext] =
    useState<typeof settings.context>(runtimeContextSeed);
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
    setRuntimeContext(runtimeContextSeed);
  }, [runtimeContextSeed]);
  useSpecificChatMode();

  const { showNotification } = useNotification();

  useEffect(() => {
    if (!threadRuntime || isNewThread) {
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

  const [thread, sendMessage, resumeInterrupt, , retryStatus] = useThreadStream(
    {
      threadId,
      context: runtimeContext,
      isMock,
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
        setIsPendingRun(false);
        void navigate(buildThreadPath(runtimeSelection, threadId, { isMock }), {
          replace: true,
        });
        if (document.hidden || !document.hasFocus()) {
          showNotification(state.title, {
            body: buildThreadCompletionNotificationBody(state),
          });
        }
      },
    },
  );

  const handleSendMessage = useCallback(
    async (
      message: PromptInputMessage,
      extraContext?: Record<string, unknown>,
    ) => {
      await sendMessage(threadId, message, extraContext);
    },
    [sendMessage, threadId],
  );
  const handleSubmit = useCallback(
    (message: PromptInputMessage, extraContext?: Record<string, unknown>) => {
      void handleSendMessage(message, extraContext);
    },
    [handleSendMessage],
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
      await resumeInterrupt(threadId, command, extraContext);
    },
    [resumeInterrupt, threadId],
  );
  const handleStop = useCallback(async () => {
    await thread.stop();
  }, [thread]);

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

    setIsPendingRun(false);
    const nextPath = buildThreadPath(runtimeSelection, threadId, { isMock });
    const currentPath = buildCurrentPath(pathname, searchParams);
    if (nextPath !== currentPath) {
      void navigate(nextPath, { replace: true });
    }
  }, [
    isMock,
    isPendingRun,
    navigate,
    pathname,
    runtimeSelection,
    searchParams,
    thread,
    threadId,
  ]);

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
          <header
            className={cn(
              "absolute top-0 right-0 left-0 z-30 flex h-12 shrink-0 items-center gap-2 px-4",
              showCenteredComposer
                ? "bg-background/0 backdrop-blur-none"
                : "bg-background/80 shadow-xs backdrop-blur",
            )}
          >
            <AgentSwitcherDialog selection={runtimeSelection} compact />
            <div className="flex w-full items-center text-sm font-medium">
              <ThreadTitle threadId={threadId} thread={thread} />
            </div>
            <div>
              <ArtifactTrigger />
            </div>
          </header>
          <main className="flex min-h-0 max-w-full grow flex-col">
            <div className="flex size-full justify-center">
              <MessageList
                className={cn("size-full", !showCenteredComposer && "pt-10")}
                threadId={threadId}
                thread={thread}
              />
            </div>
            <div className="pointer-events-none absolute right-0 bottom-0 left-0 z-30 flex justify-center px-4">
              <div
                className={cn(
                  "pointer-events-auto relative w-full",
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
                <InputBox
                  className={cn("bg-background/5 w-full -translate-y-4")}
                  threadId={threadId}
                  isNewThread={showCenteredComposer}
                  autoFocus={showCenteredComposer}
                  status={thread.isLoading ? "streaming" : "ready"}
                  context={runtimeContext}
                  retryStatus={retryStatus}
                  initialValue={inputInitialValue}
                  contextWindow={
                    showCenteredComposer
                      ? undefined
                      : thread.values.context_window
                  }
                  extraHeader={
                    showCenteredComposer && (
                      <div className="mx-auto w-full max-w-(--container-width-md) px-2">
                        <Welcome mode={runtimeContext.mode} />
                      </div>
                    )
                  }
                  disabled={env.VITE_STATIC_WEBSITE_ONLY === "true"}
                  onContextChange={(context) => setRuntimeContext(context)}
                  onSubmit={handleSubmit}
                  onStop={handleStop}
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
      </ChatBox>
    </ThreadContext.Provider>
  );
}
