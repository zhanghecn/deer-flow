"use client";

import type { Command } from "@langchain/langgraph-sdk";
import { BotIcon, PlusSquare } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo } from "react";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgentWelcome } from "@/components/workspace/agent-welcome";
import { ArtifactTrigger } from "@/components/workspace/artifacts/artifact-trigger";
import { ChatBox } from "@/components/workspace/chats/chat-box";
import { useThreadChat } from "@/components/workspace/chats/use-thread-chat";
import { InputBox } from "@/components/workspace/input-box";
import { ThreadContext } from "@/components/workspace/messages/context";
import { MessageList } from "@/components/workspace/messages/message-list";
import { ThreadTitle } from "@/components/workspace/thread-title";
import { TodoList } from "@/components/workspace/todo-list";
import { Tooltip } from "@/components/workspace/tooltip";
import {
  buildWorkspaceAgentPath,
  readAgentRuntimeSelection,
  useAgent,
} from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";
import { useNotification } from "@/core/notification/hooks";
import { useLocalSettings } from "@/core/settings";
import { useThreadStream } from "@/core/threads/hooks";
import { textOfMessage } from "@/core/threads/utils";
import { env } from "@/env";
import { cn } from "@/lib/utils";

export default function AgentChatPage() {
  const { t } = useI18n();
  const [settings, setSettings] = useLocalSettings();
  const router = useRouter();
  const searchParams = useSearchParams();

  const { agent_name } = useParams<{
    agent_name: string;
  }>();
  const runtimeSelection = useMemo(
    () => readAgentRuntimeSelection(searchParams, agent_name),
    [agent_name, searchParams],
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

  const { agent } = useAgent(agent_name, runtimeSelection.agentStatus);

  const { threadId, setThreadId, isNewThread, setIsNewThread } =
    useThreadChat();

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

  const { showNotification } = useNotification();
  const [thread, sendMessage, resumeInterrupt] = useThreadStream({
    threadId: isNewThread ? undefined : threadId,
    context: runtimeContext,
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
        const lastMessage = state.messages[state.messages.length - 1];
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
      await sendMessage(threadId, message, {
        agent_name: runtimeSelection.agentName,
        agent_status: runtimeSelection.agentStatus,
        execution_backend: runtimeSelection.executionBackend,
        remote_session_id: runtimeSelection.remoteSessionId || undefined,
        ...extraContext,
      });
    },
    [
      sendMessage,
      threadId,
      runtimeSelection.agentName,
      runtimeSelection.agentStatus,
      runtimeSelection.executionBackend,
      runtimeSelection.remoteSessionId,
    ],
  );
  const handleSubmit = useCallback(
    (message: PromptInputMessage, extraContext?: Record<string, unknown>) => {
      void handleSendMessage(message, extraContext);
    },
    [handleSendMessage],
  );
  const handleResumeInterrupt = useCallback(
    async (command: Command, extraContext?: Record<string, unknown>) => {
      await resumeInterrupt(threadId, command, {
        agent_name: runtimeSelection.agentName,
        agent_status: runtimeSelection.agentStatus,
        execution_backend: runtimeSelection.executionBackend,
        remote_session_id: runtimeSelection.remoteSessionId || undefined,
        ...extraContext,
      });
    },
    [
      resumeInterrupt,
      threadId,
      runtimeSelection.agentName,
      runtimeSelection.agentStatus,
      runtimeSelection.executionBackend,
      runtimeSelection.remoteSessionId,
    ],
  );

  const handleStop = useCallback(async () => {
    await thread.stop();
  }, [thread]);
  return (
    <ThreadContext.Provider
      value={{
        thread,
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
            {/* Agent badge */}
            <div className="flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1">
              <BotIcon className="text-primary h-3.5 w-3.5" />
              <span className="text-xs font-medium">
                {agent?.name ?? agent_name}
              </span>
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
            <div className="mr-4 flex items-center">
              <Tooltip content={t.agents.newChat}>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    router.push(
                      buildWorkspaceAgentPath({
                        agentName: runtimeSelection.agentName,
                        agentStatus: runtimeSelection.agentStatus,
                        executionBackend: runtimeSelection.executionBackend,
                        remoteSessionId: runtimeSelection.remoteSessionId,
                      }),
                    );
                  }}
                >
                  <PlusSquare /> {t.agents.newChat}
                </Button>
              </Tooltip>
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
                        <AgentWelcome
                          agent={agent}
                          agentName={runtimeSelection.agentName}
                          agentStatus={runtimeSelection.agentStatus}
                        />
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
