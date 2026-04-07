import type { BaseStream } from "@langchain/langgraph-sdk/react";
import { Loader2Icon } from "lucide-react";
import { Fragment, memo, useEffect, useMemo, useState } from "react";

import {
  Conversation,
  ConversationContent,
} from "@/components/ai-elements/conversation";
import { useArtifactObjectUrl } from "@/core/artifacts/hooks";
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
import { useSubtaskContext, useUpdateSubtask } from "@/core/tasks/context";
import type { AgentThreadState } from "@/core/threads";
import {
  extractQuestionReplyFromMessages,
  extractQuestionRequestFromMessages,
} from "@/core/threads/interrupts";
import { getFileName } from "@/core/utils/files";
import { cn } from "@/lib/utils";

import { ArtifactFileList } from "../artifacts/artifact-file-list";
import { useArtifacts } from "../artifacts";
import { StreamingIndicator } from "../streaming-indicator";

import { MarkdownContent } from "./markdown-content";
import { MessageGroup, shouldShowTrailingReasoning } from "./message-group";
import { MessageListItem } from "./message-list-item";
import { QuestionSummary } from "./question-dock";
import { MessageListSkeleton } from "./skeleton";
import { SubtaskCard } from "./subtask-card";

type TaskUpdate = Partial<Subtask> & { id: string };
type PersistedSubtaskTurn = {
  anchorMessageId: string;
  taskIds: string[];
};
type MessageRendererContext = {
  artifacts: string[];
  isLoading: boolean;
  rehypePlugins: typeof workspaceMessageRehypePlugins;
  tasks: Record<string, Subtask>;
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

export function buildTaskStatusUpdate(
  taskId: string,
  result: string,
): TaskUpdate {
  const trimmedResult = result.trim();

  if (!trimmedResult) {
    return {
      id: taskId,
      status: "in_progress",
    };
  }

  if (trimmedResult.startsWith(TASK_SUCCEEDED_PREFIX)) {
    return {
      id: taskId,
      status: "completed",
      result: trimmedResult.split(TASK_SUCCEEDED_PREFIX)[1]?.trim(),
    };
  }

  if (trimmedResult.startsWith(TASK_FAILED_PREFIX)) {
    return {
      id: taskId,
      status: "failed",
      error: trimmedResult.split(TASK_FAILED_PREFIX)[1]?.trim(),
    };
  }

  if (trimmedResult.startsWith(TASK_TIMED_OUT_PREFIX)) {
    return {
      id: taskId,
      status: "failed",
      error: trimmedResult,
    };
  }

  return {
    id: taskId,
    status: "completed",
    result: trimmedResult,
  };
}

export function collectSubtaskUpdates(messages: AgentThreadState["messages"]) {
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

function collectSubtaskIdsFromMessages(messages: AgentThreadState["messages"]) {
  const ids = new Set<string>();

  for (const message of messages) {
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

function collectSubtaskIds(group: GroupedMessage) {
  return collectSubtaskIdsFromMessages(group.messages);
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

const INLINE_IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
]);

function getArtifactDirectory(filepath: string) {
  const separatorIndex = filepath.lastIndexOf("/");
  return separatorIndex > 0 ? filepath.slice(0, separatorIndex) : null;
}

function isInlineImageArtifact(filepath: string) {
  const extension = filepath.split(".").pop()?.toLowerCase() ?? "";
  return INLINE_IMAGE_EXTENSIONS.has(extension);
}

export function collectSupplementalImageArtifacts(
  presentedFiles: string[],
  availableArtifacts: string[],
) {
  if (presentedFiles.length === 0 || availableArtifacts.length === 0) {
    return [];
  }

  // The chat timeline only knows about explicit `present_files`, while the
  // artifacts panel also discovers sibling files under `/outputs`. Surface
  // same-directory images inline so bundled outputs remain visible in the turn
  // that presented the primary deliverable.
  const presentedFileSet = new Set(presentedFiles);
  const presentedDirectories = new Set(
    presentedFiles
      .map((filepath) => getArtifactDirectory(filepath))
      .filter((filepath): filepath is string => Boolean(filepath)),
  );

  return availableArtifacts.filter((filepath) => {
    if (presentedFileSet.has(filepath) || !isInlineImageArtifact(filepath)) {
      return false;
    }

    const parentDirectory = getArtifactDirectory(filepath);
    return parentDirectory !== null && presentedDirectories.has(parentDirectory);
  });
}

function InlineArtifactImageCard({
  filepath,
  threadId,
}: {
  filepath: string;
  threadId: string;
}) {
  const { objectUrl, isLoading } = useArtifactObjectUrl({
    filepath,
    threadId,
    enabled: true,
  });
  const { select, setOpen } = useArtifacts();

  return (
    <button
      type="button"
      className="border-border/60 bg-background/70 hover:border-border hover:bg-background/90 flex overflow-hidden rounded-xl border text-left transition"
      onClick={() => {
        select(filepath);
        setOpen(true);
      }}
    >
      {isLoading || !objectUrl ? (
        <div className="bg-muted/20 flex h-40 w-full items-center justify-center">
          <Loader2Icon className="text-muted-foreground size-4 animate-spin" />
        </div>
      ) : (
        <img
          src={objectUrl}
          alt={getFileName(filepath)}
          className="h-40 w-full object-cover"
        />
      )}
    </button>
  );
}

function InlineArtifactImageGallery({
  filepaths,
  threadId,
}: {
  filepaths: string[];
  threadId: string;
}) {
  if (filepaths.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {filepaths.map((filepath) => (
        <InlineArtifactImageCard
          key={filepath}
          filepath={filepath}
          threadId={threadId}
        />
      ))}
    </div>
  );
}

function renderPrimaryMessage(group: GroupedMessage, isLoading: boolean) {
  return (
    <MessageListItem
      key={`${group.type}-${group.id ?? "group"}`}
      message={group.messages[0]!}
      isLoading={isLoading}
    />
  );
}

function renderQuestionMessage(
  group: GroupedMessage,
  renderer: MessageRendererContext,
) {
  const question = extractQuestionRequestFromMessages(group.messages);
  if (question) {
    const reply = extractQuestionReplyFromMessages(
      group.messages,
      question.requestId,
    );
    return (
      <div className="w-full" key={`question-${group.id ?? "group"}`}>
        <div className="border-border/80 bg-background/95 w-full rounded-2xl border p-4 shadow-sm">
          <QuestionSummary question={question} reply={reply} />
        </div>
      </div>
    );
  }

  const message = group.messages[0];
  if (!message || !hasContent(message)) {
    return null;
  }

  return (
    <MarkdownContent
      key={`question-${group.id ?? "group"}`}
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
  const supplementalImageArtifacts = collectSupplementalImageArtifacts(
    files,
    renderer.artifacts,
  );

  return (
    <div className="w-full" key={`present-files-${group.id ?? "group"}`}>
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
      <InlineArtifactImageGallery
        filepaths={supplementalImageArtifacts}
        threadId={renderer.threadId}
      />
    </div>
  );
}

function renderSubagentMessage(
  group: GroupedMessage,
  renderer: MessageRendererContext,
) {
  const taskIds = collectSubtaskIds(group);
  const groupTaskUpdates = collectSubtaskUpdates(group.messages);
  const resolvedTasks = taskIds.map((taskId) => {
    const liveTask = renderer.tasks[taskId];
    if (liveTask) {
      return liveTask;
    }
    return (
      groupTaskUpdates.find((task) => task.id === taskId) ?? { id: taskId }
    );
  });
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
        {getSubtaskAggregateLabel(taskIds, resolvedTasks, renderer.t)}
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

function renderPersistedSubtaskGroup(
  taskIds: string[],
  renderer: MessageRendererContext,
  key: string,
) {
  if (taskIds.length === 0) {
    return null;
  }

  const resolvedTasks = taskIds.map(
    (taskId) => renderer.tasks[taskId] ?? { id: taskId },
  );

  return (
    <div key={key} className="relative z-1 flex flex-col gap-2">
      <div className="text-foreground/80 pt-2 text-sm font-medium">
        {getSubtaskAggregateLabel(taskIds, resolvedTasks, renderer.t)}
      </div>
      {taskIds.map((taskId) => (
        <SubtaskCard
          key={"persisted-task-group-" + taskId}
          taskId={taskId}
          isLoading={false}
        />
      ))}
    </div>
  );
}

function renderProcessingMessage(
  group: GroupedMessage,
  isLoading: boolean,
  nextGroupType?: GroupedMessage["type"],
) {
  if (
    nextGroupType === "assistant:question" ||
    extractQuestionRequestFromMessages(group.messages)
  ) {
    return null;
  }

  return (
    <MessageGroup
      key={`processing-${group.id ?? "group"}`}
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
    case "assistant:question":
      return renderQuestionMessage(group, renderer);
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
  persistedTaskIds = [],
  persistedTaskAnchorMessageId,
  threadId,
}: {
  groups: GroupedMessage[];
  isLoading: boolean;
  persistedTaskIds?: string[];
  persistedTaskAnchorMessageId?: string | null;
  threadId: string;
}) {
  const { t } = useI18n();
  const { artifacts } = useArtifacts();
  const { tasks } = useSubtaskContext();
  const rehypePlugins = workspaceMessageRehypePlugins;
  const renderer: MessageRendererContext = {
    artifacts,
    isLoading,
    rehypePlugins,
    tasks,
    threadId,
    t,
  };
  const hasRenderedPersistedGroup =
    persistedTaskIds.length > 0 &&
    groups.some((group) => group.id === persistedTaskAnchorMessageId);

  return (
    <>
      {groups.map((group, index) => (
        <Fragment key={`${group.type}-${group.id ?? "group"}-${index}`}>
          {renderGroupedMessage(group, renderer, groups[index + 1]?.type)}
          {persistedTaskIds.length > 0 &&
            group.id === persistedTaskAnchorMessageId &&
            renderPersistedSubtaskGroup(
              persistedTaskIds,
              renderer,
              `persisted-subtasks-${group.id ?? index}`,
            )}
        </Fragment>
      ))}
      {persistedTaskIds.length > 0 &&
        !hasRenderedPersistedGroup &&
        renderPersistedSubtaskGroup(
          persistedTaskIds,
          renderer,
          "persisted-subtasks-tail",
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
  const lastTurnStartIndex = useMemo(
    () => findCurrentTurnStartIndex(messages),
    [messages],
  );
  const lastTurnMessages = useMemo(
    () => messages.slice(lastTurnStartIndex),
    [lastTurnStartIndex, messages],
  );
  const lastTurnAnchorMessageId =
    messages[lastTurnStartIndex]?.type === "human"
      ? (messages[lastTurnStartIndex]?.id ?? null)
      : null;
  const { historyMessages, currentTurnMessages } =
    useStreamingMessagePartitions(messages, isStreamingCurrentTurn);
  const [persistedSubtaskTurn, setPersistedSubtaskTurn] =
    useState<PersistedSubtaskTurn | null>(null);

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
  const lastTurnTaskIds = useMemo(
    () => collectSubtaskIdsFromMessages(lastTurnMessages),
    [lastTurnMessages],
  );
  const visibleCurrentTurnTaskIds = useMemo(
    () =>
      currentTurnGroups.flatMap((group) =>
        group.type === "assistant:subagent" ? collectSubtaskIds(group) : [],
      ),
    [currentTurnGroups],
  );
  const persistedCurrentTurnTaskIds = useMemo(() => {
    if (!persistedSubtaskTurn) {
      return [];
    }

    const visibleTaskIds = new Set(visibleCurrentTurnTaskIds);
    return persistedSubtaskTurn.taskIds.filter(
      (taskId) => !visibleTaskIds.has(taskId),
    );
  }, [persistedSubtaskTurn, visibleCurrentTurnTaskIds]);

  useEffect(() => {
    for (const update of subtaskUpdates) {
      updateSubtask(update);
    }
  }, [subtaskUpdates, updateSubtask]);

  useEffect(() => {
    setPersistedSubtaskTurn(null);
  }, [threadId]);

  useEffect(() => {
    if (!lastTurnAnchorMessageId) {
      setPersistedSubtaskTurn(null);
      return;
    }

    setPersistedSubtaskTurn((previous) => {
      if (previous?.anchorMessageId === lastTurnAnchorMessageId) {
        if (lastTurnTaskIds.length > 0) {
          return {
            anchorMessageId: lastTurnAnchorMessageId,
            taskIds: lastTurnTaskIds,
          };
        }
        return previous;
      }

      if (lastTurnTaskIds.length === 0) {
        return null;
      }

      return {
        anchorMessageId: lastTurnAnchorMessageId,
        taskIds: lastTurnTaskIds,
      };
    });
  }, [lastTurnAnchorMessageId, lastTurnTaskIds]);

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
            persistedTaskAnchorMessageId={null}
            threadId={threadId}
          />
        )}
        <GroupedMessagesContent
          groups={currentTurnGroups}
          isLoading={isStreamingCurrentTurn}
          persistedTaskAnchorMessageId={
            isStreamingCurrentTurn
              ? null
              : persistedSubtaskTurn?.anchorMessageId
          }
          persistedTaskIds={
            isStreamingCurrentTurn ? [] : persistedCurrentTurnTaskIds
          }
          threadId={threadId}
        />
        {thread.isLoading && <StreamingIndicator className="my-4" />}
        <div style={{ height: `${paddingBottom}px` }} />
      </ConversationContent>
    </Conversation>
  );
}
