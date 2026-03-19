"use client";

import type { Command } from "@langchain/langgraph-sdk";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { type PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { AgentWorkspaceDialog } from "@/components/workspace/agent-workspace-dialog";
import { ArtifactTrigger } from "@/components/workspace/artifacts/artifact-trigger";
import { useSpecificChatMode } from "@/components/workspace/chats/use-chat-mode";
import { useThreadChat } from "@/components/workspace/chats/use-thread-chat";
import { InputBox } from "@/components/workspace/input-box";
import { ThreadContext } from "@/components/workspace/messages/context";
import { ThreadTitle } from "@/components/workspace/thread-title";
import { TodoList } from "@/components/workspace/todo-list";
import { Welcome } from "@/components/workspace/welcome";
import {
  buildWorkspaceAgentPath,
  readAgentRuntimeSelection,
  type ResolvedAgentRuntimeSelection,
} from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";
import { useNotification } from "@/core/notification/hooks";
import { useLocalSettings } from "@/core/settings";
import { useThreadStream } from "@/core/threads/hooks";
import { useThreadRuntime } from "@/core/threads/query-hooks";
import {
  resolveThreadRuntimeBinding,
  textOfMessage,
} from "@/core/threads/utils";
import { env } from "@/env";
import { cn } from "@/lib/utils";

const ChatBox = dynamic(
  () => import("@/components/workspace/chats/chat-box").then((m) => m.ChatBox),
  { ssr: false },
);
const MessageList = dynamic(
  () =>
    import("@/components/workspace/messages/message-list").then(
      (m) => m.MessageList,
    ),
  { ssr: false },
);

export default function ChatPage() {
  const { t } = useI18n();
  const pathname = usePathname();
  const [settings] = useLocalSettings();
  const searchParams = useSearchParams();
  const hasPendingRun = searchParams.get("pending_run") === "1";
  const routeRuntimeSelection = useMemo(
    () => readAgentRuntimeSelection(searchParams),
    [searchParams],
  );

  const { threadId, setThreadId, isNewThread, setIsNewThread, isMock } =
    useThreadChat();
  const { data: threadRuntime, isLoading: threadRuntimeLoading } =
    useThreadRuntime(isMock || isNewThread ? null : threadId);
  const boundThreadRuntime = useMemo(
    () => resolveThreadRuntimeBinding(threadRuntime),
    [threadRuntime],
  );
  const runtimeSelection = useMemo(
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
  ) as ResolvedAgentRuntimeSelection;
  const runtimeContextSeed = useMemo(
    () => ({
      ...settings.context,
      agent_name: runtimeSelection.agentName,
      agent_status: runtimeSelection.agentStatus,
      execution_backend: runtimeSelection.executionBackend,
      remote_session_id: runtimeSelection.remoteSessionId || undefined,
      model_name: boundThreadRuntime.modelName ?? settings.context.model_name,
    }),
    [boundThreadRuntime.modelName, runtimeSelection, settings.context],
  );
  const [runtimeContext, setRuntimeContext] =
    useState<typeof settings.context>(runtimeContextSeed);

  useEffect(() => {
    setRuntimeContext(runtimeContextSeed);
  }, [runtimeContextSeed]);
  useSpecificChatMode();

  const { showNotification } = useNotification();

  useEffect(() => {
    if (!threadRuntime || isNewThread) {
      return;
    }

    const runtimeChanged =
      routeRuntimeSelection.agentName !== runtimeSelection.agentName ||
      routeRuntimeSelection.agentStatus !== runtimeSelection.agentStatus ||
      routeRuntimeSelection.executionBackend !==
        runtimeSelection.executionBackend ||
      routeRuntimeSelection.remoteSessionId !==
        runtimeSelection.remoteSessionId;
    if (!runtimeChanged) {
      return;
    }

    const basePath = buildWorkspaceAgentPath(
      {
        agentName: runtimeSelection.agentName,
        agentStatus: runtimeSelection.agentStatus,
        executionBackend: runtimeSelection.executionBackend,
        remoteSessionId: runtimeSelection.remoteSessionId,
      },
      threadId,
    );
    const [nextPathname = basePath, nextSearch = ""] = basePath.split("?", 2);
    const params = new URLSearchParams(nextSearch);
    if (hasPendingRun) {
      params.set("pending_run", "1");
    }
    if (isMock) {
      params.set("mock", "true");
    }
    const query = params.toString();
    const nextPath = query ? `${nextPathname}?${query}` : nextPathname;
    const currentPath = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
    if (nextPath !== currentPath) {
      window.location.replace(nextPath);
    }
  }, [
    hasPendingRun,
    isMock,
    isNewThread,
    pathname,
    routeRuntimeSelection,
    runtimeSelection,
    searchParams,
    threadId,
    threadRuntime,
  ]);

  const [thread, sendMessage, resumeInterrupt] = useThreadStream({
    threadId: isNewThread ? undefined : threadId,
    context: runtimeContext,
    isMock,
    skipInitialHistory: hasPendingRun,
    onStart: (createdThreadId) => {
      setThreadId(createdThreadId);
      setIsNewThread(false);
      history.replaceState(
        null,
        "",
        buildWorkspaceAgentPath(
          {
            agentName: runtimeSelection.agentName,
            agentStatus: runtimeSelection.agentStatus,
            executionBackend: runtimeSelection.executionBackend,
            remoteSessionId: runtimeSelection.remoteSessionId,
          },
          createdThreadId,
        ),
      );
    },
    onFinish: (state) => {
      if (hasPendingRun) {
        let nextPath = buildWorkspaceAgentPath(
          {
            agentName: runtimeSelection.agentName,
            agentStatus: runtimeSelection.agentStatus,
            executionBackend: runtimeSelection.executionBackend,
            remoteSessionId: runtimeSelection.remoteSessionId,
          },
          threadId,
        );
        if (isMock) {
          nextPath += nextPath.includes("?") ? "&mock=true" : "?mock=true";
        }
        history.replaceState(null, "", nextPath);
      }
      if (document.hidden || !document.hasFocus()) {
        let body = "Conversation finished";
        const lastMessage = state.messages.at(-1);
        if (lastMessage) {
          const textContent = textOfMessage(lastMessage);
          if (textContent) {
            body =
              textContent.length > 200
                ? textContent.substring(0, 200) + "..."
                : textContent;
          }
        }
        showNotification(state.title, { body });
      }
    },
  });

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
  const handleResumeInterrupt = useCallback(
    async (command: Command, extraContext?: Record<string, unknown>) => {
      await resumeInterrupt(threadId, command, extraContext);
    },
    [resumeInterrupt, threadId],
  );
  const handleStop = useCallback(async () => {
    await thread.stop();
  }, [thread]);

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
              isNewThread
                ? "bg-background/0 backdrop-blur-none"
                : "bg-background/80 shadow-xs backdrop-blur",
            )}
          >
            <AgentWorkspaceDialog selection={runtimeSelection} compact />
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
                className={cn("size-full", !isNewThread && "pt-10")}
                threadId={threadId}
                thread={thread}
              />
            </div>
            <div className="absolute right-0 bottom-0 left-0 z-30 flex justify-center px-4">
              <div
                className={cn(
                  "relative w-full",
                  isNewThread && "-translate-y-[calc(50vh-96px)]",
                  isNewThread
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
                  isNewThread={isNewThread}
                  autoFocus={isNewThread}
                  status={thread.isLoading ? "streaming" : "ready"}
                  context={runtimeContext}
                  contextWindow={
                    isNewThread ? undefined : thread.values.context_window
                  }
                  extraHeader={
                    isNewThread && (
                      <div className="mx-auto w-full max-w-(--container-width-md) px-2">
                        <Welcome mode={runtimeContext.mode} />
                      </div>
                    )
                  }
                  disabled={env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true"}
                  onContextChange={(context) => setRuntimeContext(context)}
                  onSubmit={handleSubmit}
                  onStop={handleStop}
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
      </ChatBox>
    </ThreadContext.Provider>
  );
}
