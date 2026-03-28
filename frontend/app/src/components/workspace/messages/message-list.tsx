import type { BaseStream } from "@langchain/langgraph-sdk/react";
import { memo, useEffect, useMemo, useState } from "react";

import {
  Conversation,
  ConversationContent,
} from "@/components/ai-elements/conversation";
import { useI18n } from "@/core/i18n/hooks";
import {
  extractContentFromMessage,
  extractPresentFilesFromMessage,
  extractTextFromMessage,
  groupMessages,
  hasContent,
  hasPresentFiles,
  hasReasoning,
  stripNextStepsFromText,
  type MessageGroup as GroupedMessage,
} from "@/core/messages/utils";
import { workspaceMessageRehypePlugins } from "@/core/streamdown";
import type { Subtask } from "@/core/tasks";
import { useUpdateSubtask } from "@/core/tasks/context";
import type { AgentThreadState } from "@/core/threads";
import type { AgentInterrupt } from "@/core/threads/types";
import { cn } from "@/lib/utils";

import { ArtifactFileList } from "../artifacts/artifact-file-list";
import { StreamingIndicator } from "../streaming-indicator";

import { ClarificationInterrupt } from "./clarification-interrupt";
import { MarkdownContent } from "./markdown-content";
import { MessageGroup, shouldShowTrailingReasoning } from "./message-group";
import { MessageListItem } from "./message-list-item";
import { MessageListSkeleton } from "./skeleton";
import { SubtaskCard } from "./subtask-card";

type TaskUpdate = Partial<Subtask> & { id: string };
type MessageRendererContext = {
  isLoading: boolean;
  rehypePlugins: typeof workspaceMessageRehypePlugins;
  threadId: string;
  t: ReturnType<typeof useI18n>["t"];
};

const TASK_SUCCEEDED_PREFIX = "Task Succeeded. Result:";
const TASK_FAILED_PREFIX = "Task failed.";
const TASK_TIMED_OUT_PREFIX = "Task timed out";

type TaskToolCallFallbackArgs = {
  description?: string;
  prompt?: string;
  subagent_type?: string;
};

function getTaskToolCallFallback(toolCall: {
  args?: TaskToolCallFallbackArgs;
}): Pick<Subtask, "description" | "prompt" | "subagent_type"> {
  return {
    description: toolCall.args?.description ?? "Running subtask",
    prompt: toolCall.args?.prompt ?? "",
    subagent_type: toolCall.args?.subagent_type ?? "general-purpose",
  };
}

function mergeTaskUpdate(
  updates: Map<string, TaskUpdate>,
  nextUpdate: TaskUpdate,
) {
  updates.set(nextUpdate.id, {
    ...(updates.get(nextUpdate.id) ?? {}),
    ...nextUpdate,
  });
}

function buildTaskStatusUpdate(taskId: string, result: string): TaskUpdate {
  if (result.startsWith(TASK_SUCCEEDED_PREFIX)) {
    return {
      id: taskId,
      status: "completed",
      result: result.split(TASK_SUCCEEDED_PREFIX)[1]?.trim(),
    };
  }

  if (result.startsWith(TASK_FAILED_PREFIX)) {
    return {
      id: taskId,
      status: "failed",
      error: result.split(TASK_FAILED_PREFIX)[1]?.trim(),
    };
  }

  if (result.startsWith(TASK_TIMED_OUT_PREFIX)) {
    return {
      id: taskId,
      status: "failed",
      error: result,
    };
  }

  return {
    id: taskId,
    status: "in_progress",
  };
}

function collectSubtaskUpdates(messages: AgentThreadState["messages"]) {
  const updates = new Map<string, TaskUpdate>();

  for (const message of messages) {
    if (message.type === "ai") {
      for (const toolCall of message.tool_calls ?? []) {
        if (toolCall.name !== "task" || !toolCall.id) {
          continue;
        }
        mergeTaskUpdate(updates, {
          id: toolCall.id,
          subagent_type: toolCall.args.subagent_type,
          description: toolCall.args.description,
          prompt: toolCall.args.prompt,
          status: "in_progress",
        });
      }
      continue;
    }

    if (message.type !== "tool" || !message.tool_call_id) {
      continue;
    }

    const taskId = message.tool_call_id;
    const result = extractTextFromMessage(message);
    mergeTaskUpdate(updates, buildTaskStatusUpdate(taskId, result));
  }

  return [...updates.values()];
}

function collectSubtaskIds(group: GroupedMessage) {
  const ids = new Set<string>();
  for (const message of group.messages) {
    if (message.type !== "ai") {
      continue;
    }
    for (const toolCall of message.tool_calls ?? []) {
      if (toolCall.name === "task" && toolCall.id) {
        ids.add(toolCall.id);
      }
    }
  }
  return [...ids];
}

export type SubtaskAggregateStatus = "running" | "completed" | "failed";

export function getSubtaskAggregateStatus(
  taskIds: string[],
  tasks: Array<Pick<Subtask, "id"> & { status?: Subtask["status"] }>,
): SubtaskAggregateStatus {
  if (taskIds.length === 0) {
    return "running";
  }

  const statuses = taskIds
    .map((taskId) => tasks.find((task) => task.id === taskId)?.status)
    .filter((status): status is Subtask["status"] => status !== undefined);

  if (statuses.includes("failed")) {
    return "failed";
  }

  if (
    statuses.length === taskIds.length &&
    statuses.every((status) => status === "completed")
  ) {
    return "completed";
  }

  return "running";
}

export function getSubtaskAggregateLabel(
  taskIds: string[],
  tasks: Array<Pick<Subtask, "id"> & { status?: Subtask["status"] }>,
  t: ReturnType<typeof useI18n>["t"],
) {
  const count = taskIds.length;
  const aggregateStatus = getSubtaskAggregateStatus(taskIds, tasks);

  if (aggregateStatus === "completed") {
    return t.subtasks.completedGroup(count);
  }

  if (aggregateStatus === "failed") {
    return t.subtasks.failedGroup(count);
  }

  return t.subtasks.executing(count);
}

function findCurrentTurnStartIndex(messages: AgentThreadState["messages"]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.type === "human") {
      return index;
    }
  }
  return 0;
}

function collectPresentFilePaths(group: GroupedMessage) {
  const files: string[] = [];

  for (const message of group.messages) {
    if (hasPresentFiles(message)) {
      files.push(...extractPresentFilesFromMessage(message));
    }
  }

  return files;
}

function renderPrimaryMessage(group: GroupedMessage, isLoading: boolean) {
  return (
    <MessageListItem
      key={group.id}
      message={group.messages[0]!}
      isLoading={isLoading}
    />
  );
}

function renderClarificationMessage(
  group: GroupedMessage,
  renderer: MessageRendererContext,
) {
  const message = group.messages[0];
  if (!message || !hasContent(message)) {
    return null;
  }

  return (
    <MarkdownContent
      key={group.id}
      content={extractContentFromMessage(message)}
      isLoading={renderer.isLoading}
      rehypePlugins={renderer.rehypePlugins}
    />
  );
}

function renderPresentFilesMessage(
  group: GroupedMessage,
  renderer: MessageRendererContext,
) {
  const leadMessage = group.messages[0];
  const files = collectPresentFilePaths(group);

  return (
    <div className="w-full" key={group.id}>
      {leadMessage && hasContent(leadMessage) && (
        <MarkdownContent
          content={stripNextStepsFromText(
            extractContentFromMessage(leadMessage),
          )}
          isLoading={renderer.isLoading}
          rehypePlugins={renderer.rehypePlugins}
          className="mb-4"
        />
      )}
      <ArtifactFileList files={files} threadId={renderer.threadId} />
    </div>
  );
}

function renderSubagentMessage(
  group: GroupedMessage,
  renderer: MessageRendererContext,
) {
  const taskIds = collectSubtaskIds(group);
  const groupTaskUpdates = collectSubtaskUpdates(group.messages);
  const subagentMessages = group.messages.filter(
    (message) => message.type === "ai",
  );
  const content: React.ReactNode[] = [];

  if (taskIds.length > 0) {
    content.push(
      <div
        key={`subtask-summary-${group.id}`}
        className="text-foreground/80 pt-2 text-sm font-medium"
      >
        {getSubtaskAggregateLabel(taskIds, groupTaskUpdates, renderer.t)}
      </div>,
    );
  }

  for (const message of subagentMessages) {
    if (hasReasoning(message)) {
      content.push(
        <MessageGroup
          key={"thinking-group-" + message.id}
          messages={[message]}
          isLoading={renderer.isLoading}
        />,
      );
    }

    for (const toolCall of message.tool_calls ?? []) {
      if (toolCall.name !== "task" || !toolCall.id) {
        continue;
      }
      content.push(
        <SubtaskCard
          key={"task-group-" + toolCall.id}
          taskId={toolCall.id}
          fallbackTask={getTaskToolCallFallback(toolCall)}
          isLoading={renderer.isLoading}
        />,
      );
    }
  }

  return (
    <div
      key={"subtask-group-" + group.id}
      className="relative z-1 flex flex-col gap-2"
    >
      {content}
    </div>
  );
}

function renderProcessingMessage(
  group: GroupedMessage,
  isLoading: boolean,
  nextGroupType?: GroupedMessage["type"],
) {
  return (
    <MessageGroup
      key={"group-" + group.id}
      messages={group.messages}
      isLoading={isLoading}
      showTrailingReasoning={shouldShowTrailingReasoning(
        nextGroupType,
        isLoading,
      )}
    />
  );
}

function renderGroupedMessage(
  group: GroupedMessage,
  renderer: MessageRendererContext,
  nextGroupType?: GroupedMessage["type"],
) {
  switch (group.type) {
    case "human":
    case "assistant":
      return renderPrimaryMessage(group, renderer.isLoading);
    case "assistant:clarification":
      return renderClarificationMessage(group, renderer);
    case "assistant:present-files":
      return renderPresentFilesMessage(group, renderer);
    case "assistant:subagent":
      return renderSubagentMessage(group, renderer);
    default:
      return renderProcessingMessage(group, renderer.isLoading, nextGroupType);
  }
}

function useStreamingMessagePartitions(
  messages: AgentThreadState["messages"],
  isThreadStreaming: boolean,
) {
  const [anchoredHistoryMessages, setAnchoredHistoryMessages] = useState<
    AgentThreadState["messages"] | null
  >(null);

  useEffect(() => {
    if (!isThreadStreaming) {
      setAnchoredHistoryMessages(null);
      return;
    }

    setAnchoredHistoryMessages((previous) => {
      if (previous !== null) {
        return previous;
      }

      const currentTurnStartIndex = findCurrentTurnStartIndex(messages);
      return messages.slice(0, currentTurnStartIndex);
    });
  }, [messages, isThreadStreaming]);

  const historyMessages = useMemo(
    () => anchoredHistoryMessages ?? [],
    [anchoredHistoryMessages],
  );
  const currentTurnMessages = useMemo(
    () =>
      anchoredHistoryMessages === null
        ? messages
        : messages.slice(anchoredHistoryMessages.length),
    [messages, anchoredHistoryMessages],
  );

  return {
    historyMessages,
    currentTurnMessages,
  };
}

const GroupedMessagesContent = memo(function GroupedMessagesContent({
  groups,
  isLoading,
  threadId,
}: {
  groups: GroupedMessage[];
  isLoading: boolean;
  threadId: string;
}) {
  const { t } = useI18n();
  const rehypePlugins = workspaceMessageRehypePlugins;
  const renderer: MessageRendererContext = {
    isLoading,
    rehypePlugins,
    threadId,
    t,
  };

  return (
    <>
      {groups.map((group, index) =>
        renderGroupedMessage(group, renderer, groups[index + 1]?.type),
      )}
    </>
  );
});

export function MessageList({
  className,
  threadId,
  thread,
  paddingBottom = 240,
}: {
  className?: string;
  threadId: string;
  thread: BaseStream<AgentThreadState>;
  paddingBottom?: number;
}) {
  const updateSubtask = useUpdateSubtask();
  const messages = thread.messages;
  const isStreamingCurrentTurn = thread.isLoading && !thread.isThreadLoading;
  const { historyMessages, currentTurnMessages } =
    useStreamingMessagePartitions(messages, isStreamingCurrentTurn);

  const historyGroups = useMemo(
    () => groupMessages(historyMessages, (group) => group),
    [historyMessages],
  );
  const currentTurnGroups = useMemo(
    () => groupMessages(currentTurnMessages, (group) => group),
    [currentTurnMessages],
  );
  const subtaskUpdates = useMemo(
    () => collectSubtaskUpdates(messages),
    [messages],
  );

  useEffect(() => {
    for (const update of subtaskUpdates) {
      updateSubtask(update);
    }
  }, [subtaskUpdates, updateSubtask]);

  if (thread.isThreadLoading && messages.length === 0) {
    return <MessageListSkeleton />;
  }
  return (
    <Conversation
      className={cn("flex size-full flex-col justify-center", className)}
    >
      <ConversationContent className="mx-auto w-full max-w-(--container-width-md) gap-8 pt-12">
        {historyGroups.length > 0 && (
          <GroupedMessagesContent
            groups={historyGroups}
            isLoading={false}
            threadId={threadId}
          />
        )}
        <GroupedMessagesContent
          groups={currentTurnGroups}
          isLoading={isStreamingCurrentTurn}
          threadId={threadId}
        />
        <ClarificationInterrupt
          className="mt-2"
          interrupt={thread.interrupt as AgentInterrupt | undefined}
        />
        {thread.isLoading && <StreamingIndicator className="my-4" />}
        <div style={{ height: `${paddingBottom}px` }} />
      </ConversationContent>
    </Conversation>
  );
}
