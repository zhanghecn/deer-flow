"use client";

import type { Command } from "@langchain/langgraph-sdk";
import { BotIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo } from "react";

import { type PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { Badge } from "@/components/ui/badge";
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
} from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";
import { useNotification } from "@/core/notification/hooks";
import { useLocalSettings } from "@/core/settings";
import { useThreadStream } from "@/core/threads/hooks";
import { textOfMessage } from "@/core/threads/utils";
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
  const [settings, setSettings] = useLocalSettings();
  const searchParams = useSearchParams();
  const runtimeSelection = useMemo(
    () => readAgentRuntimeSelection(searchParams),
    [searchParams],
  );
  const displayAgentName = runtimeSelection.agentName || "lead_agent";
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

  const { threadId, setThreadId, isNewThread, setIsNewThread, isMock } =
    useThreadChat();
  useSpecificChatMode();

  const { showNotification } = useNotification();

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

  const [thread, sendMessage, resumeInterrupt] = useThreadStream({
    threadId: isNewThread ? undefined : threadId,
    context: runtimeContext,
    isMock,
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
    async (message: PromptInputMessage, extraContext?: Record<string, unknown>) => {
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
            <div className="flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1">
              <BotIcon className="text-primary h-3.5 w-3.5" />
              <span className="text-xs font-medium">{displayAgentName}</span>
            </div>
            <Badge variant="outline" className="shrink-0 text-[10px]">
              {runtimeSelection.agentStatus}
            </Badge>
            {runtimeSelection.executionBackend === "remote" && (
              <Badge variant="outline" className="shrink-0 text-[10px]">
                remote cli
              </Badge>
            )}
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
                  onContextChange={(context) => setSettings("context", context)}
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
