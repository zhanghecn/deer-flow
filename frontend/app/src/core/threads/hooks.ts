import type {
  AIMessage,
  Command,
  Message,
  ThreadState,
} from "@langchain/langgraph-sdk";
import { useStream } from "@langchain/langgraph-sdk/react";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";

import { getAPIClient } from "../api";
import { useAuth } from "../auth/hooks";
import { useI18n } from "../i18n/hooks";
import { createThreadKnowledgeBase } from "../knowledge/api";
import type { FileInMessage } from "../messages/utils";
import { getLocalSettings, type LocalSettings } from "../settings";
import { useUpdateSubtask } from "../tasks/context";
import type { UploadedFileInfo } from "../uploads";
import { uploadFiles } from "../uploads";

import { normalizeThreadError, shouldIgnoreThreadError } from "./error";
import {
  DEFAULT_SUBAGENT_ENABLED,
  getReasoningEffortForMode,
  normalizeThreadMode,
  resolveSubmitFlags,
} from "./mode";
import {
  buildThreadRuntimeQueryKey,
  buildThreadSearchQueryKey,
  DEFAULT_THREAD_SEARCH_PARAMS,
  THREAD_SEARCH_QUERY_KEY,
} from "./search";
import type {
  AgentInterruptValue,
  AgentInterrupt,
  AgentThread,
  AgentThreadState,
  ExecutionEvent,
  ExecutionStatus,
  TaskRunningEvent,
} from "./types";

export type ToolEndEvent = {
  name: string;
  data: unknown;
};

type ThreadContext = LocalSettings["context"];
type PromptInputFile = PromptInputMessage["files"][number];

export type ThreadStreamOptions = {
  threadId?: string | null | undefined;
  context: ThreadContext;
  isMock?: boolean;
  skipInitialHistory?: boolean;
  onStart?: (threadId: string) => void;
  onFinish?: (state: AgentThreadState) => void;
  onStop?: (state: AgentThreadState | null) => void;
  onToolEnd?: (event: ToolEndEvent) => void;
  onError?: (message: string) => void;
};

const LEAD_AGENT_ID = "lead_agent";
const FLASH_STREAM_THROTTLE = 96;
const DEFAULT_STREAM_THROTTLE = 192;
const HISTORY_PAGE_SIZE = 1;
const STATE_HYDRATION_DELAY_MS = process.env.NODE_ENV === "test" ? 0 : 1500;
const PENDING_RUN_RECOVERY_POLL_MS =
  process.env.NODE_ENV === "test" ? 25 : 5000;
const STREAM_MODES = ["values", "messages-tuple", "custom"] as const;
const ACTIVE_RUN_OWNER_STORAGE_PREFIX = "openagents:stream-owner:";
const ACTIVE_RUN_METADATA_STORAGE_PREFIX = "lg:stream:";
type ThreadOverride = {
  source: "hydration" | "snapshot";
  values: AgentThreadState;
  messages: Message[];
  history: ThreadState<AgentThreadState>[];
  interrupt: AgentInterrupt | undefined;
  experimental_branchTree?: unknown;
};

type WindowActivity = {
  isActive: boolean;
  activationId: number;
};

type ActiveRunTarget = {
  threadId: string | null;
  runId: string | null;
};

function resolveThreadContext(context: ThreadContext): ThreadContext {
  const storedContext = getLocalSettings().context;
  const mode = normalizeThreadMode(context.mode ?? storedContext.mode);
  const hasExplicitModelName = Object.prototype.hasOwnProperty.call(
    context,
    "model_name",
  );

  return {
    ...context,
    model_name: hasExplicitModelName
      ? context.model_name
      : storedContext.model_name,
    mode,
    reasoning_effort:
      context.reasoning_effort ??
      storedContext.reasoning_effort ??
      (mode ? getReasoningEffortForMode(mode) : undefined),
    agent_name: context.agent_name ?? storedContext.agent_name,
    agent_status: context.agent_status ?? storedContext.agent_status,
    subagent_enabled:
      context.subagent_enabled ??
      storedContext.subagent_enabled ??
      DEFAULT_SUBAGENT_ENABLED,
    execution_backend:
      context.execution_backend ?? storedContext.execution_backend,
    remote_session_id:
      context.remote_session_id ?? storedContext.remote_session_id,
  };
}

function readWindowActivity(): boolean {
  if (typeof document === "undefined") {
    return true;
  }

  return !document.hidden && document.hasFocus();
}

function useWindowActivity(): WindowActivity {
  const [activity, setActivity] = useState<WindowActivity>(() => {
    const isActive = readWindowActivity();
    return {
      isActive,
      activationId: isActive ? 0 : -1,
    };
  });

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return;
    }

    const syncActivity = () => {
      const nextIsActive = readWindowActivity();
      setActivity((current) => {
        if (current.isActive === nextIsActive) {
          return current;
        }

        return {
          isActive: nextIsActive,
          activationId: nextIsActive
            ? current.activationId + 1
            : current.activationId,
        };
      });
    };

    syncActivity();
    document.addEventListener("visibilitychange", syncActivity);
    window.addEventListener("focus", syncActivity);
    window.addEventListener("blur", syncActivity);

    return () => {
      document.removeEventListener("visibilitychange", syncActivity);
      window.removeEventListener("focus", syncActivity);
      window.removeEventListener("blur", syncActivity);
    };
  }, []);

  return activity;
}

function getActiveRunOwnerStorageKey(threadId: string) {
  return `${ACTIVE_RUN_OWNER_STORAGE_PREFIX}${threadId}`;
}

function getActiveRunMetadataStorageKey(threadId: string) {
  return `${ACTIVE_RUN_METADATA_STORAGE_PREFIX}${threadId}`;
}

function hasLocalActiveRunOwnership(threadId?: string | null): boolean {
  if (typeof window === "undefined" || !threadId) {
    return false;
  }

  try {
    return (
      window.sessionStorage.getItem(getActiveRunOwnerStorageKey(threadId)) ===
      "1"
    );
  } catch {
    return false;
  }
}

function readStoredActiveRunId(threadId?: string | null): string | null {
  if (typeof window === "undefined" || !threadId) {
    return null;
  }

  try {
    return (
      window.sessionStorage.getItem(getActiveRunMetadataStorageKey(threadId)) ??
      null
    );
  } catch {
    return null;
  }
}

function storeActiveRunId(threadId?: string | null, runId?: string | null) {
  if (typeof window === "undefined" || !threadId || !runId) {
    return;
  }

  try {
    window.sessionStorage.setItem(
      getActiveRunMetadataStorageKey(threadId),
      runId,
    );
  } catch {
    // Ignore storage failures and fall back to state hydration recovery.
  }
}

function markLocalActiveRunOwnership(threadId?: string | null) {
  if (typeof window === "undefined" || !threadId) {
    return;
  }

  try {
    window.sessionStorage.setItem(getActiveRunOwnerStorageKey(threadId), "1");
  } catch {
    // Ignore storage failures and fall back to non-resumable behavior.
  }
}

function clearLocalActiveRunOwnership(threadId?: string | null) {
  if (typeof window === "undefined" || !threadId) {
    return;
  }

  try {
    window.sessionStorage.removeItem(getActiveRunOwnerStorageKey(threadId));
  } catch {
    // Ignore storage failures during cleanup.
  }
}

function clearStoredActiveRunId(threadId?: string | null) {
  if (typeof window === "undefined" || !threadId) {
    return;
  }

  try {
    window.sessionStorage.removeItem(getActiveRunMetadataStorageKey(threadId));
  } catch {
    // Ignore storage failures during cleanup.
  }
}

function resolveActiveRunTarget(
  routeThreadId?: string | null,
  streamThreadId?: string | null,
): ActiveRunTarget {
  // New-thread routes keep a draft thread ID until navigation catches up.
  // Once the stream is created, `streamThreadId` is the canonical backend ID
  // and must win for run lookup/cancel.
  const threadId = streamThreadId ?? routeThreadId ?? null;

  return {
    threadId,
    runId: readStoredActiveRunId(threadId),
  };
}

function clearActiveRunTarget(target: ActiveRunTarget) {
  clearLocalActiveRunOwnership(target.threadId);
  clearStoredActiveRunId(target.threadId);
}

function logRunCancelFailure(target: ActiveRunTarget, error: unknown) {
  if (!target.threadId || !target.runId) {
    return;
  }

  console.warn(
    `Failed to cancel active run ${target.runId} for thread ${target.threadId}:`,
    error,
  );
}

async function stopStreamingRun(options: {
  stopStream: () => Promise<unknown>;
  cancelRun: () => Promise<unknown>;
}) {
  const [stopResult, cancelResult] = await Promise.allSettled([
    options.stopStream(),
    options.cancelRun(),
  ]);

  if (stopResult.status === "rejected") {
    throw stopResult.reason;
  }

  return cancelResult;
}

function resolveAgentName(
  context: ThreadContext,
  extraContext?: Record<string, unknown>,
) {
  const fromContext =
    typeof context.agent_name === "string" ? context.agent_name.trim() : "";
  if (fromContext) {
    return fromContext;
  }

  const fromExtra =
    typeof extraContext?.agent_name === "string"
      ? extraContext.agent_name.trim()
      : "";
  return fromExtra || LEAD_AGENT_ID;
}

function resolveStreamThrottle(context: ThreadContext) {
  return normalizeThreadMode(context.mode) === "flash"
    ? FLASH_STREAM_THROTTLE
    : DEFAULT_STREAM_THROTTLE;
}

function requireModelName(context: ThreadContext) {
  const modelName =
    typeof context.model_name === "string" ? context.model_name : "";
  if (!modelName) {
    throw new Error("Model is required before submitting a run.");
  }
  return modelName;
}

function toUploadingFiles(files: PromptInputFile[]) {
  return files.map(
    (file): FileInMessage => ({
      filename: file.filename ?? "",
      size: 0,
      status: "uploading",
    }),
  );
}

function toUploadedFiles(files: UploadedFileInfo[]) {
  return files.map(
    (file): FileInMessage => ({
      filename: file.filename,
      size: Number(file.size),
      path: file.virtual_path,
      markdown_file: file.markdown_file,
      markdown_virtual_path: file.markdown_virtual_path,
      markdown_artifact_url: file.markdown_artifact_url,
      status: "uploaded",
    }),
  );
}

function toIndexedKnowledgeFiles(files: File[]) {
  return files.map(
    (file): FileInMessage => ({
      filename: file.name,
      size: file.size,
      status: "uploaded",
    }),
  );
}

function buildOptimisticMessages(
  text: string,
  files: PromptInputFile[],
  uploadingLabel: string,
) {
  const optimisticFiles = toUploadingFiles(files);
  const timestamp = Date.now();
  const optimisticMessages: Message[] = [
    {
      type: "human",
      id: `opt-human-${timestamp}`,
      content: text ? [{ type: "text", text }] : "",
      additional_kwargs:
        optimisticFiles.length > 0 ? { files: optimisticFiles } : {},
    },
  ];

  if (optimisticFiles.length > 0) {
    optimisticMessages.push({
      type: "ai",
      id: `opt-ai-${timestamp}`,
      content: uploadingLabel,
      additional_kwargs: { element: "task" },
    });
  }

  return optimisticMessages;
}

function buildProvisionalThreadTitle(text: string) {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "Untitled";
  }

  return normalized.slice(0, 80);
}

function buildPendingThreadRecord(
  threadId: string,
  context: ThreadContext,
  extraContext: Record<string, unknown> | undefined,
  text: string,
): AgentThread {
  const normalizedRemoteSessionId =
    typeof context.remote_session_id === "string"
      ? context.remote_session_id.trim()
      : "";
  const normalizedModelName =
    typeof context.model_name === "string" ? context.model_name.trim() : "";

  return {
    thread_id: threadId,
    updated_at: new Date().toISOString(),
    values: {
      title: buildProvisionalThreadTitle(text),
    },
    agent_name: resolveAgentName(context, extraContext),
    agent_status: context.agent_status === "prod" ? "prod" : "dev",
    execution_backend:
      context.execution_backend === "remote" ? "remote" : undefined,
    remote_session_id: normalizedRemoteSessionId || undefined,
    model_name: normalizedModelName || undefined,
  } as AgentThread;
}

function upsertPendingThreadRecord(
  oldData: AgentThread[] | undefined,
  pendingRecord: AgentThread,
) {
  if (!oldData || oldData.length === 0) {
    return [pendingRecord];
  }

  const existingRecord = oldData.find(
    (thread) => thread.thread_id === pendingRecord.thread_id,
  );
  const mergedRecord = existingRecord
    ? {
        ...existingRecord,
        ...pendingRecord,
        values: {
          ...(existingRecord.values ?? {}),
          ...(pendingRecord.values ?? {}),
        },
      }
    : pendingRecord;

  return [
    mergedRecord,
    ...oldData.filter((thread) => thread.thread_id !== pendingRecord.thread_id),
  ];
}

function primePendingThreadCaches(
  queryClient: QueryClient,
  threadId: string,
  context: ThreadContext,
  extraContext: Record<string, unknown> | undefined,
  text: string,
) {
  const pendingRecord = buildPendingThreadRecord(
    threadId,
    context,
    extraContext,
    text,
  );

  queryClient.setQueryData(
    buildThreadSearchQueryKey(DEFAULT_THREAD_SEARCH_PARAMS),
    (oldData: AgentThread[] | undefined) =>
      upsertPendingThreadRecord(oldData, pendingRecord),
  );
  queryClient.setQueriesData(
    {
      queryKey: THREAD_SEARCH_QUERY_KEY,
      exact: false,
    },
    (oldData: AgentThread[] | undefined) =>
      upsertPendingThreadRecord(oldData, pendingRecord),
  );

  queryClient.setQueryData(buildThreadRuntimeQueryKey(threadId), {
    thread_id: threadId,
    agent_name: pendingRecord.agent_name,
    agent_status: pendingRecord.agent_status,
    execution_backend: pendingRecord.execution_backend,
    remote_session_id: pendingRecord.remote_session_id,
    model_name: pendingRecord.model_name,
  });
}

function invalidateThreadSearchCaches(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    queryKey: THREAD_SEARCH_QUERY_KEY,
  });
}

function replaceOptimisticHumanFiles(
  messages: Message[],
  uploadedFiles: FileInMessage[],
) {
  const [humanMessage, ...remainingMessages] = messages;
  if (!humanMessage || messages.length < 2) {
    return messages;
  }

  return [
    {
      ...humanMessage,
      additional_kwargs: { files: uploadedFiles },
    },
    ...remainingMessages,
  ];
}

async function convertPromptFileToUpload(file: PromptInputFile) {
  if (!file.url || !file.filename) {
    return null;
  }

  try {
    const response = await fetch(file.url);
    const blob = await response.blob();
    return new File([blob], file.filename, {
      type: file.mediaType || blob.type,
    });
  } catch (error) {
    console.error(`Failed to fetch file ${file.filename}:`, error);
    return null;
  }
}

async function prepareFilesForUpload(files: PromptInputFile[]) {
  const convertedFiles = await Promise.all(
    files.map((file) => convertPromptFileToUpload(file)),
  );
  const uploadableFiles = convertedFiles.filter(
    (file): file is File => file !== null,
  );
  const failedConversions = convertedFiles.length - uploadableFiles.length;

  if (failedConversions > 0) {
    throw new Error(
      `Failed to prepare ${failedConversions} attachment(s) for upload. Please retry.`,
    );
  }

  return uploadableFiles;
}

async function uploadPromptFiles(threadId: string, files: PromptInputFile[]) {
  if (files.length === 0) {
    return [];
  }

  const uploadableFiles = await prepareFilesForUpload(files);
  if (uploadableFiles.length === 0) {
    return [];
  }

  const response = await uploadFiles(threadId, uploadableFiles);
  return response.files;
}

function buildSubmissionPayload(text: string, files: UploadedFileInfo[]) {
  const uploadedFiles = toUploadedFiles(files);

  return {
    messages: [
      {
        type: "human" as const,
        content: [
          {
            type: "text" as const,
            text,
          },
        ],
        additional_kwargs:
          uploadedFiles.length > 0 ? { files: uploadedFiles } : {},
      },
    ],
  };
}

function buildSubmitOptions(
  threadId: string,
  context: ThreadContext,
  modelName: string,
  locale: string,
  extraContext?: Record<string, unknown>,
  command?: Command,
) {
  const agentName = resolveAgentName(context, extraContext);
  const submitFlags = resolveSubmitFlags(context.mode, {
    subagentEnabled: context.subagent_enabled,
  });

  return {
    threadId,
    streamSubgraphs: true,
    streamResumable: true,
    streamMode: [...STREAM_MODES],
    config: {
      configurable: {
        ...extraContext,
        ...context,
        agent_name: agentName,
        model_name: modelName,
        locale,
        mode: submitFlags.mode,
        thinking_enabled: submitFlags.thinking_enabled,
        is_plan_mode: submitFlags.is_plan_mode,
        subagent_enabled: submitFlags.subagent_enabled,
        reasoning_effort: submitFlags.reasoning_effort,
        thread_id: threadId,
      },
    },
    command,
  };
}

function isKnowledgeAddCommand(extraContext?: Record<string, unknown>) {
  return extraContext?.command_name === "knowledge-add";
}

function buildThreadOverride(
  source: ThreadOverride["source"],
  values: AgentThreadState,
  messages: Message[],
  history: ThreadState<AgentThreadState>[],
  interrupt: AgentInterrupt | undefined,
  experimental_branchTree?: unknown,
): ThreadOverride {
  return {
    source,
    values,
    messages,
    history,
    interrupt,
    experimental_branchTree,
  };
}

function extractThreadMessages(values: AgentThreadState): Message[] {
  return Array.isArray(values.messages) ? values.messages : [];
}

function buildThreadOverrideFromState(
  source: ThreadOverride["source"],
  values: AgentThreadState,
  history: ThreadState<AgentThreadState>[],
  interrupt: AgentInterrupt | undefined,
  experimentalBranchTree?: unknown,
): ThreadOverride | null {
  const messages = extractThreadMessages(values);
  if (messages.length === 0) {
    return null;
  }

  return buildThreadOverride(
    source,
    values,
    messages,
    history,
    interrupt,
    experimentalBranchTree,
  );
}

function hasRenderableAssistantMessage(messages: Message[]) {
  return messages.some((message) => message.type === "ai");
}

function getExperimentalBranchTree(source: object) {
  if (!("experimental_branchTree" in source)) {
    return undefined;
  }

  try {
    // The SDK exposes branch data via a getter that throws unless
    // `fetchStateHistory` is enabled. Stop/recovery flows still need to run
    // while initial history is deferred, so treat branch state as optional.
    return (source as { experimental_branchTree?: unknown })
      .experimental_branchTree;
  } catch {
    return undefined;
  }
}

function getThreadHistorySnapshot(
  source: object,
): ThreadState<AgentThreadState>[] {
  if (!("history" in source)) {
    return [];
  }

  try {
    // The SDK exposes `history` via a getter that throws when
    // `fetchStateHistory` is disabled. Stop/recovery flows temporarily keep
    // history reads disabled after manually seeding the latest snapshot, so
    // treat the live getter as optional and fall back to the seeded override.
    const history = (source as { history?: unknown }).history;
    return Array.isArray(history)
      ? (history as ThreadState<AgentThreadState>[])
      : [];
  } catch {
    return [];
  }
}

function extractPrimaryInterrupt(
  state: object | null | undefined,
): AgentInterrupt | undefined {
  if (!state || !("interrupts" in state)) {
    return undefined;
  }

  const interrupts = (state as { interrupts?: unknown }).interrupts;
  if (!Array.isArray(interrupts) || interrupts.length === 0) {
    return undefined;
  }

  const [interrupt] = interrupts;
  return interrupt as AgentInterrupt | undefined;
}

function mergeOptimisticMessages<T extends { messages: Message[] }>(
  thread: T,
  optimisticMessages: Message[],
) {
  if (optimisticMessages.length === 0) {
    return thread;
  }

  return cloneThreadStream(thread, {
    messages: [...thread.messages, ...optimisticMessages],
  });
}

function cloneThreadStream<T extends object>(
  thread: T,
  overrides: Record<string, unknown>,
): T {
  const descriptors = Object.getOwnPropertyDescriptors(thread) as Record<
    string,
    PropertyDescriptor
  >;

  for (const [key, value] of Object.entries(overrides)) {
    descriptors[key] = {
      configurable: true,
      enumerable: true,
      writable: true,
      value,
    };
  }

  return Object.create(Object.getPrototypeOf(thread), descriptors) as T;
}

function extractLatestContextWindow(
  history: unknown,
): AgentThreadState["context_window"] | undefined {
  if (!Array.isArray(history)) {
    return undefined;
  }

  for (const item of history) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const values = (item as { values?: AgentThreadState }).values;
    if (!values || typeof values !== "object") {
      continue;
    }
    if (values.context_window) {
      return values.context_window;
    }
  }

  return undefined;
}

function extractLatestPersistedTaskError(
  history: unknown,
): unknown | undefined {
  if (!Array.isArray(history)) {
    return undefined;
  }

  for (const item of history) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const tasks = (item as { tasks?: unknown }).tasks;
    if (!Array.isArray(tasks) || tasks.length === 0) {
      continue;
    }

    for (let index = tasks.length - 1; index >= 0; index -= 1) {
      const task = tasks[index];
      if (!task || typeof task !== "object") {
        continue;
      }

      const error = (task as { error?: unknown }).error;
      if (error != null) {
        return error;
      }
    }
  }

  return undefined;
}

function extractLatestTaskError(tasks: unknown): unknown | undefined {
  if (!Array.isArray(tasks)) {
    return undefined;
  }

  for (let index = tasks.length - 1; index >= 0; index -= 1) {
    const task = tasks[index];
    if (!task || typeof task !== "object") {
      continue;
    }

    const error = (task as { error?: unknown }).error;
    if (error != null) {
      return error;
    }
  }

  return undefined;
}

function isTransientConnectionReplay(error: unknown): boolean {
  return /connection error/i.test(normalizeThreadError(error));
}

function isMissingRunReplay(error: unknown): boolean {
  const normalized = normalizeThreadError(error).toLowerCase();
  return normalized.includes("run not found");
}

function shouldSuppressOwnedMissingRunReplay(
  error: unknown,
  threadId: string | null | undefined,
): boolean {
  if (!threadId || !isMissingRunReplay(error)) {
    return false;
  }

  if (!hasLocalActiveRunOwnership(threadId)) {
    return false;
  }

  // Local ownership means this tab is already running the thread recovery
  // flow. A stale run id should quietly fall back to state hydration instead
  // of surfacing a fake terminal error toast.
  clearStoredActiveRunId(threadId);
  return true;
}

function buildThreadErrorToastId(
  threadId: string | null | undefined,
  message: string,
) {
  return `thread-error:${threadId ?? "unknown"}:${message}`;
}

function buildPassthroughThreadHistory<
  StateType extends Record<string, unknown>,
>(): {
  data: ThreadState<StateType>[];
  error: undefined;
  isLoading: false;
  mutate: () => Promise<ThreadState<StateType>[]>;
} {
  return {
    data: [],
    error: undefined,
    isLoading: false,
    mutate: async () => [],
  };
}

function serializeMessageForComparison(message: Message) {
  return JSON.stringify({
    id: message.id,
    type: message.type,
    name: "name" in message ? message.name : undefined,
    content: message.content,
    tool_calls: "tool_calls" in message ? message.tool_calls : undefined,
    tool_call_id: "tool_call_id" in message ? message.tool_call_id : undefined,
    additional_kwargs: message.additional_kwargs,
    status: "status" in message ? message.status : undefined,
  });
}

function areEquivalentMessageLists(left: Message[], right: Message[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((message, index) => {
    const otherMessage = right[index];
    if (!otherMessage) {
      return false;
    }

    return (
      serializeMessageForComparison(message) ===
      serializeMessageForComparison(otherMessage)
    );
  });
}

function isExecutionEvent(event: unknown): event is ExecutionEvent {
  if (!event || typeof event !== "object") {
    return false;
  }

  return (
    "type" in event &&
    event.type === "execution_event" &&
    "event" in event &&
    typeof event.event === "string" &&
    "occurred_at" in event &&
    typeof event.occurred_at === "string"
  );
}

function isTaskRunningEvent(event: unknown): event is TaskRunningEvent {
  if (!event || typeof event !== "object") {
    return false;
  }

  return (
    "type" in event &&
    event.type === "task_running" &&
    "task_id" in event &&
    typeof event.task_id === "string" &&
    "message" in event &&
    typeof event.message === "object" &&
    event.message !== null
  );
}

function applyExecutionEvent(
  previous: ExecutionStatus | null,
  event: ExecutionEvent,
): ExecutionStatus | null {
  const runStartedAt =
    previous?.run_started_at ?? event.started_at ?? event.occurred_at;

  if (event.event === "run_started") {
    return {
      event: "run_started",
      phase_kind: "run",
      started_at: event.started_at ?? event.occurred_at,
      run_started_at: event.started_at ?? event.occurred_at,
      terminal: false,
    };
  }

  if (event.event === "phase_started") {
    return {
      event: "phase_started",
      phase: event.phase,
      phase_kind: event.phase_kind,
      started_at: event.started_at ?? event.occurred_at,
      run_started_at: runStartedAt,
      tool_name: event.tool_name,
      terminal: false,
    };
  }

  if (event.event === "phase_finished") {
    return {
      event: "phase_finished",
      phase: event.phase,
      phase_kind: event.phase_kind,
      started_at:
        event.started_at ?? previous?.started_at ?? event.occurred_at,
      run_started_at: runStartedAt,
      finished_at: event.finished_at ?? event.occurred_at,
      duration_ms: event.duration_ms,
      tool_name: event.tool_name,
      error: event.error,
      error_type: event.error_type,
      terminal: false,
    };
  }

  if (
    event.event === "retrying" ||
    event.event === "retry_completed" ||
    event.event === "retry_failed"
  ) {
    return {
      event: event.event,
      phase: event.phase ?? "retry_wait",
      phase_kind: "retry",
      started_at: event.started_at ?? event.occurred_at,
      run_started_at: runStartedAt,
      finished_at: event.finished_at,
      tool_name: event.tool_name,
      retry_count: event.retry_count,
      max_retries: event.max_retries,
      delay_seconds: event.delay_seconds,
      error: event.error,
      error_type: event.error_type,
      terminal: false,
    };
  }

  return previous;
}

function finalizeExecutionStatus(
  previous: ExecutionStatus | null,
  {
    terminalEvent,
    error = null,
  }: {
    terminalEvent: "completed" | "failed" | "interrupted";
    error?: unknown;
  },
): ExecutionStatus | null {
  if (!previous) {
    return null;
  }
  if (previous.terminal) {
    return previous;
  }

  const finishedAt = new Date().toISOString();
  const startedAt = new Date(previous.run_started_at);
  const endAt = new Date(finishedAt);
  const totalDurationMs = Number.isNaN(startedAt.getTime())
    ? previous.total_duration_ms
    : Math.max(0, endAt.getTime() - startedAt.getTime());

  return {
    ...previous,
    event: terminalEvent,
    finished_at: finishedAt,
    total_duration_ms: totalDurationMs,
    error:
      terminalEvent === "failed" ? normalizeThreadError(error) : previous.error,
    terminal: true,
  };
}

export function useThreadStream({
  threadId,
  context,
  isMock,
  skipInitialHistory = false,
  onStart,
  onFinish,
  onStop,
  onToolEnd,
  onError,
}: ThreadStreamOptions) {
  const { t, locale } = useI18n();
  const { authenticated } = useAuth();
  const resolvedContext = useMemo(
    () => resolveThreadContext(context),
    [context],
  );
  const requestRuntimeIdentity = useMemo(
    () => ({
      agent_name:
        typeof resolvedContext.agent_name === "string"
          ? resolvedContext.agent_name
          : undefined,
      agent_status:
        resolvedContext.agent_status === "prod"
          ? ("prod" as const)
          : resolvedContext.agent_status === "dev"
            ? ("dev" as const)
            : undefined,
      execution_backend:
        resolvedContext.execution_backend === "remote"
          ? ("remote" as const)
          : undefined,
      remote_session_id:
        typeof resolvedContext.remote_session_id === "string"
          ? resolvedContext.remote_session_id
          : undefined,
      model_name:
        typeof resolvedContext.model_name === "string"
          ? resolvedContext.model_name
          : undefined,
    }),
    [
      resolvedContext.agent_name,
      resolvedContext.agent_status,
      resolvedContext.execution_backend,
      resolvedContext.model_name,
      resolvedContext.remote_session_id,
    ],
  );
  const apiClient = getAPIClient(
    isMock,
    threadId ?? null,
    requestRuntimeIdentity,
  );
  const { isActive: isWindowActive, activationId: windowActivationId } =
    useWindowActivity();
  const [streamThreadId, setStreamThreadId] = useState<string | null>(
    () => threadId ?? null,
  );
  const [threadOverride, setThreadOverride] = useState<ThreadOverride | null>(
    null,
  );
  const [pendingRecoveryLoading, setPendingRecoveryLoading] = useState(false);
  const [executionStatus, setExecutionStatus] =
    useState<ExecutionStatus | null>(null);
  const [historyEnabled, setHistoryEnabled] = useState(
    () => !!threadId && !skipInitialHistory,
  );
  const hasStartedStreamRef = useRef(false);
  const previousThreadIdRef = useRef<string | null | undefined>(threadId);
  const lastErrorMessageRef = useRef<string | null>(null);
  const joinedRunIdRef = useRef<string | null>(null);
  const lastHydrationActivationRef = useRef<number | null>(null);
  const stateHydrationInFlightRef = useRef(false);
  const deferStateHydrationRef = useRef(false);
  const terminalStateNotifiedRef = useRef(false);
  const manualHistorySeedRef = useRef(false);
  const stopPromiseRef = useRef<Promise<void> | null>(null);
  const ensureThreadPromiseRef = useRef<Promise<void> | null>(null);
  const ensureRequestedThreadIdRef = useRef<string | null>(null);
  const ensuredThreadIdRef = useRef<string | null>(null);
  const streamThrottle = resolveStreamThrottle(resolvedContext);
  const hasResolvedModelName =
    typeof resolvedContext.model_name === "string" &&
    resolvedContext.model_name.trim().length > 0;
  const passthroughThreadHistory = useMemo(
    () =>
      historyEnabled || !(threadId ?? streamThreadId)
        ? undefined
        : buildPassthroughThreadHistory<AgentThreadState>(),
    [historyEnabled, streamThreadId, threadId],
  );

  useEffect(() => {
    const previousThreadId = previousThreadIdRef.current;
    const createdThreadDuringCurrentSession =
      !previousThreadId && !!threadId && hasStartedStreamRef.current;

    deferStateHydrationRef.current = createdThreadDuringCurrentSession;
    hasStartedStreamRef.current = false;
    manualHistorySeedRef.current = false;
    previousThreadIdRef.current = threadId;
    setHistoryEnabled(
      threadId
        ? !(createdThreadDuringCurrentSession || skipInitialHistory)
        : false,
    );

    if (!threadId || !authenticated) {
      ensureThreadPromiseRef.current = null;
      ensureRequestedThreadIdRef.current = null;
      ensuredThreadIdRef.current = null;
      setStreamThreadId(null);
      return;
    }

    setStreamThreadId(threadId);
    if (
      createdThreadDuringCurrentSession ||
      (skipInitialHistory && hasLocalActiveRunOwnership(threadId))
    ) {
      return;
    }

    ensureRequestedThreadIdRef.current = threadId;
    ensuredThreadIdRef.current = null;
    const ensurePromise = apiClient.threads
      .create({
        threadId,
        ifExists: "do_nothing",
        graphId: LEAD_AGENT_ID,
      })
      .then(() => {
        if (ensureRequestedThreadIdRef.current === threadId) {
          ensuredThreadIdRef.current = threadId;
        }
      });
    ensureThreadPromiseRef.current = ensurePromise;
    void ensurePromise.catch((error) => {
      console.warn(
        `Failed to ensure thread exists before loading history (${threadId}):`,
        error,
      );
    });
  }, [threadId, authenticated, apiClient, skipInitialHistory]);

  const queryClient = useQueryClient();
  const updateSubtask = useUpdateSubtask();
  const notifyThreadError = useCallback(
    (error: unknown) => {
      const activeThreadId = streamThreadId ?? threadId;
      if (shouldSuppressOwnedMissingRunReplay(error, activeThreadId)) {
        lastErrorMessageRef.current = null;
        return null;
      }

      if (shouldIgnoreThreadError(error)) {
        // Query/stream cancellation is local teardown, not a user-visible run
        // failure. Keep the retry banner clear without surfacing a false error.
        setExecutionStatus((current) =>
          finalizeExecutionStatus(current, {
            terminalEvent: "interrupted",
            error,
          }),
        );
        lastErrorMessageRef.current = null;
        return null;
      }

      const message = normalizeThreadError(error);
      setExecutionStatus((current) =>
        finalizeExecutionStatus(current, {
          terminalEvent: "failed",
          error,
        }),
      );
      if (lastErrorMessageRef.current === message) {
        return message;
      }

      lastErrorMessageRef.current = message;
      // Reopened threads can trigger the same persisted failure through more
      // than one hydration path. Keep a stable toast id per thread/message so
      // the UI updates the existing notification instead of stacking clones.
      toast.error(message, {
        id: buildThreadErrorToastId(activeThreadId, message),
      });
      onError?.(message);
      return message;
    },
    [onError, streamThreadId, threadId],
  );
  const finalizeRecoveredRun = useCallback(
    (state: AgentThreadState, resolvedThreadId?: string | null) => {
      if (terminalStateNotifiedRef.current) {
        return;
      }

      terminalStateNotifiedRef.current = true;
      setPendingRecoveryLoading(false);
      setExecutionStatus((current) =>
        finalizeExecutionStatus(current, {
          terminalEvent: "completed",
        }),
      );
      const activeThreadId = resolvedThreadId ?? streamThreadId ?? threadId;
      clearLocalActiveRunOwnership(activeThreadId);
      clearStoredActiveRunId(activeThreadId);
      if (activeThreadId) {
        deferStateHydrationRef.current = false;
        lastHydrationActivationRef.current = null;
        manualHistorySeedRef.current = false;
        setHistoryEnabled(true);
      }
      lastErrorMessageRef.current = null;
      onFinish?.(state);
      void invalidateThreadSearchCaches(queryClient);
    },
    [onFinish, queryClient, streamThreadId, threadId],
  );
  const finalizeRecoveredTerminalError = useCallback(
    (
      state: AgentThreadState,
      error: unknown,
      resolvedThreadId?: string | null,
    ) => {
      if (terminalStateNotifiedRef.current) {
        return;
      }

      terminalStateNotifiedRef.current = true;
      setPendingRecoveryLoading(false);
      setExecutionStatus((current) =>
        finalizeExecutionStatus(current, {
          terminalEvent: "failed",
          error,
        }),
      );
      const activeThreadId = resolvedThreadId ?? streamThreadId ?? threadId;
      clearLocalActiveRunOwnership(activeThreadId);
      clearStoredActiveRunId(activeThreadId);
      if (activeThreadId) {
        // A persisted task error means the backend already finished this run,
        // even if the last checkpoint still reports a stale `next` step.
        deferStateHydrationRef.current = false;
        lastHydrationActivationRef.current = null;
        manualHistorySeedRef.current = false;
        setHistoryEnabled(true);
      }
      notifyThreadError(error);
      onStop?.(state);
      void invalidateThreadSearchCaches(queryClient);
    },
    [notifyThreadError, onStop, queryClient, streamThreadId, threadId],
  );
  const thread = useStream<
    AgentThreadState,
    { InterruptType: AgentInterruptValue }
  >({
    client: apiClient,
    assistantId: LEAD_AGENT_ID,
    threadId: streamThreadId,
    throttle: streamThrottle,
    reconnectOnMount: false,
    thread: passthroughThreadHistory,
    // Fresh threads can race with the first run before the runtime model is
    // persisted. Delay history reads until the first turn finishes.
    // Manual stop already seeds the latest history snapshot, so suppress the
    // SDK history fetch for that transition to avoid a duplicate history call.
    fetchStateHistory:
      historyEnabled && !manualHistorySeedRef.current
        ? { limit: HISTORY_PAGE_SIZE }
        : false,
    onCreated(meta) {
      setStreamThreadId(meta.thread_id);
      storeActiveRunId(
        meta.thread_id,
        "run_id" in meta && typeof meta.run_id === "string"
          ? meta.run_id
          : null,
      );
      if (!hasStartedStreamRef.current) {
        onStart?.(meta.thread_id);
        hasStartedStreamRef.current = true;
      }
    },
    onLangChainEvent(event) {
      if (event.event === "on_tool_end") {
        onToolEnd?.({
          name: event.name,
          data: event.data,
        });
      }
    },
    onCustomEvent(event: unknown) {
      if (isExecutionEvent(event)) {
        setExecutionStatus((current) => applyExecutionEvent(current, event));
        return;
      }

      if (isTaskRunningEvent(event)) {
        updateSubtask({ id: event.task_id, latestMessage: event.message as AIMessage });
      }
    },
    onFinish(state) {
      finalizeRecoveredRun(state.values, streamThreadId ?? threadId ?? null);
    },
    onError(error) {
      notifyThreadError(error);
    },
  });

  const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([]);
  const threadMessageCount = thread.messages.length;
  const previousMessageCountRef = useRef(thread.messages.length);
  const joinStreamRef = useRef(thread.joinStream);
  const threadLoadingRef = useRef(thread.isLoading);
  const isThreadReady = !threadId || streamThreadId === threadId;
  const latestPersistedTaskError = useMemo(() => {
    if (!historyEnabled) {
      return undefined;
    }

    return extractLatestPersistedTaskError(getThreadHistorySnapshot(thread));
  }, [historyEnabled, thread]);

  joinStreamRef.current = thread.joinStream;
  threadLoadingRef.current = thread.isLoading;

  useEffect(() => {
    setThreadOverride(null);
    setPendingRecoveryLoading(false);
    setExecutionStatus(null);
    joinedRunIdRef.current = null;
    lastHydrationActivationRef.current = null;
    stateHydrationInFlightRef.current = false;
    terminalStateNotifiedRef.current = false;
  }, [threadId]);

  useEffect(() => {
    const shouldReplayPersistedError =
      threadId != null &&
      !hasLocalActiveRunOwnership(threadId) &&
      latestPersistedTaskError != null &&
      !isTransientConnectionReplay(latestPersistedTaskError);

    if (!thread.error && !shouldReplayPersistedError) {
      // Reopened threads can briefly drop hydrated task errors while history is
      // still loading. Keep the last surfaced message until hydration settles
      // so the same persisted failure is not replayed twice.
      if (!thread.isLoading) {
        lastErrorMessageRef.current = null;
      }
      return;
    }

    if (!thread.error && shouldReplayPersistedError) {
      // LangGraph state recovery can surface failed task history without
      // rehydrating `thread.error`. Replay actionable persisted failures so
      // reopened threads do not look idle after a model-side failure.
      notifyThreadError(latestPersistedTaskError);
      return;
    }

    // Reopening a thread rehydrates the last persisted run error before this
    // browser owns any active stream. Only suppress stale transport failures
    // from old runs; actionable errors such as 429s should still surface.
    if (
      threadId &&
      !hasLocalActiveRunOwnership(threadId) &&
      latestPersistedTaskError != null &&
      isTransientConnectionReplay(latestPersistedTaskError) &&
      normalizeThreadError(latestPersistedTaskError) ===
        normalizeThreadError(thread.error)
    ) {
      return;
    }

    notifyThreadError(thread.error);
  }, [
    latestPersistedTaskError,
    notifyThreadError,
    thread.error,
    thread.isLoading,
    threadId,
  ]);

  useEffect(() => {
    if (!thread.isLoading) {
      setExecutionStatus((current) =>
        finalizeExecutionStatus(current, {
          terminalEvent: thread.error ? "failed" : "completed",
          error: thread.error,
        }),
      );
      return;
    }
    // Once the SDK reports a live active stream again, the recovery spinner can
    // hand control back to the real stream state.
    setPendingRecoveryLoading(false);
  }, [thread.isLoading]);

  useEffect(() => {
    if (!threadId || !authenticated || thread.isLoading || !isThreadReady) {
      return;
    }

    // Route switches reuse the same hook instance for one render while
    // `useStream` is still bound to the previous thread. Wait until the live
    // stream target matches the route before replaying stored run metadata, or
    // the SDK can ask the old thread to resume the new thread's run id.
    if (!hasLocalActiveRunOwnership(threadId)) {
      return;
    }

    const activeRunId = readStoredActiveRunId(threadId);
    if (!activeRunId || joinedRunIdRef.current === activeRunId) {
      return;
    }

    const joinStream = joinStreamRef.current;
    if (typeof joinStream !== "function") {
      return;
    }

    joinedRunIdRef.current = activeRunId;
    setPendingRecoveryLoading(true);
    void joinStream(activeRunId, undefined, {
      streamMode: [...STREAM_MODES],
    }).catch((error: unknown) => {
      joinedRunIdRef.current = null;
      if (isMissingRunReplay(error)) {
        // A stale persisted run id should not surface as a user-facing failure.
        // Keep ownership so state hydration can reconnect to a fresher run id.
        clearStoredActiveRunId(threadId);
        return;
      }
      notifyThreadError(error);
    });
  }, [
    authenticated,
    isThreadReady,
    notifyThreadError,
    thread.isLoading,
    threadId,
  ]);

  useEffect(() => {
    const shouldRefreshFromActivation =
      lastHydrationActivationRef.current !== windowActivationId;
    const shouldDeferStateHydration =
      deferStateHydrationRef.current && !historyEnabled;

    if (!threadId || !authenticated || !isWindowActive || !isThreadReady) {
      return;
    }

    if (thread.isLoading) {
      return;
    }

    if (!historyEnabled && !hasResolvedModelName) {
      return;
    }

    if (shouldDeferStateHydration) {
      return;
    }

    if (!shouldRefreshFromActivation) {
      return;
    }

    if (stateHydrationInFlightRef.current) {
      return;
    }

    let cancelled = false;
    stateHydrationInFlightRef.current = true;
    const hydrateState = () => {
      void apiClient.threads
        .getState<AgentThreadState>(threadId, undefined, {
          subgraphs: true,
        })
        .then((state) => {
          if (cancelled) {
            return;
          }

          const nextThreadOverride = buildThreadOverrideFromState(
            "hydration",
            state.values,
            [],
            extractPrimaryInterrupt(state),
          );
          if (nextThreadOverride) {
            setThreadOverride(nextThreadOverride);
          }

          const taskError = extractLatestTaskError(
            "tasks" in state ? state.tasks : undefined,
          );
          if (taskError != null) {
            finalizeRecoveredTerminalError(state.values, taskError, threadId);
            return;
          }

          const allowLocalRunResume = hasLocalActiveRunOwnership(threadId);
          const hasPendingRun =
            Array.isArray(state.next) && state.next.length > 0;
          setPendingRecoveryLoading(
            allowLocalRunResume && hasPendingRun && !threadLoadingRef.current,
          );

          const activeRunId =
            typeof state.metadata?.run_id === "string"
              ? state.metadata.run_id
              : null;
          const shouldJoinPendingRun =
            allowLocalRunResume &&
            !threadLoadingRef.current &&
            hasPendingRun &&
            !!activeRunId;
          const joinStream = joinStreamRef.current;

          if (
            shouldJoinPendingRun &&
            activeRunId &&
            joinedRunIdRef.current !== activeRunId &&
            typeof joinStream === "function"
          ) {
            joinedRunIdRef.current = activeRunId;
            void joinStream(activeRunId, undefined, {
              streamMode: [...STREAM_MODES],
            }).catch((error: unknown) => {
              joinedRunIdRef.current = null;
              if (isMissingRunReplay(error)) {
                clearStoredActiveRunId(threadId);
                return;
              }
              notifyThreadError(error);
            });
          }
        })
        .catch(() => {
          // Fresh threads often have no persisted state yet; ignore that case.
        })
        .finally(() => {
          if (!cancelled) {
            stateHydrationInFlightRef.current = false;
            lastHydrationActivationRef.current = windowActivationId;
          }
        });
    };

    const timeoutId =
      historyEnabled || STATE_HYDRATION_DELAY_MS === 0
        ? null
        : window.setTimeout(hydrateState, STATE_HYDRATION_DELAY_MS);

    if (timeoutId == null) {
      hydrateState();
    }

    return () => {
      cancelled = true;
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
      stateHydrationInFlightRef.current = false;
    };
  }, [
    apiClient,
    authenticated,
    finalizeRecoveredTerminalError,
    hasResolvedModelName,
    historyEnabled,
    isThreadReady,
    isWindowActive,
    notifyThreadError,
    thread.isLoading,
    threadId,
    windowActivationId,
  ]);

  useEffect(() => {
    if (
      !threadId ||
      !authenticated ||
      historyEnabled ||
      !isThreadReady ||
      thread.isLoading ||
      !isWindowActive ||
      !hasResolvedModelName
    ) {
      return;
    }

    if (!hasLocalActiveRunOwnership(threadId)) {
      return;
    }

    let cancelled = false;
    const pollState = () => {
      void apiClient.threads
        .getState<AgentThreadState>(threadId, undefined, {
          subgraphs: true,
        })
        .then((state) => {
          if (cancelled) {
            return;
          }

          const nextThreadOverride = buildThreadOverrideFromState(
            "hydration",
            state.values,
            [],
            extractPrimaryInterrupt(state),
            getExperimentalBranchTree(thread),
          );
          if (nextThreadOverride) {
            setThreadOverride(nextThreadOverride);
          }

          const taskError = extractLatestTaskError(
            "tasks" in state ? state.tasks : undefined,
          );
          if (taskError != null) {
            finalizeRecoveredTerminalError(state.values, taskError, threadId);
            return;
          }

          const hasPendingRun =
            Array.isArray(state.next) && state.next.length > 0;
          setPendingRecoveryLoading(hasPendingRun);

          const stateMessages = extractThreadMessages(state.values);
          if (stateMessages.length === 0) {
            return;
          }

          const isTerminalRun =
            Array.isArray(state.next) && state.next.length === 0;
          if (isTerminalRun && hasRenderableAssistantMessage(stateMessages)) {
            finalizeRecoveredRun(state.values, threadId);
          }
        })
        .catch(() => {
          // Ignore transient recovery fetch failures; the live stream may still win.
        });
    };

    pollState();
    const intervalId = window.setInterval(
      pollState,
      PENDING_RUN_RECOVERY_POLL_MS,
    );

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    apiClient,
    authenticated,
    finalizeRecoveredTerminalError,
    finalizeRecoveredRun,
    hasResolvedModelName,
    historyEnabled,
    isThreadReady,
    isWindowActive,
    thread,
    thread.isLoading,
    threadId,
  ]);

  useEffect(() => {
    if (
      optimisticMessages.length > 0 &&
      threadMessageCount > previousMessageCountRef.current
    ) {
      setOptimisticMessages([]);
    }
  }, [threadMessageCount, optimisticMessages.length]);

  useEffect(() => {
    if (threadOverride?.source !== "hydration") {
      return;
    }

    if (thread.messages.length === 0) {
      return;
    }

    if (thread.messages.length < threadOverride.messages.length) {
      return;
    }

    if (areEquivalentMessageLists(thread.messages, threadOverride.messages)) {
      return;
    }

    setThreadOverride(null);
  }, [thread.messages, threadOverride]);

  const sendMessage = useCallback(
    async (
      runThreadId: string,
      message: PromptInputMessage,
      extraContext?: Record<string, unknown>,
    ) => {
      if (!authenticated) {
        throw new Error("Authentication is required before submitting a run.");
      }

      const selectedModelName = requireModelName(resolvedContext);
      const text = message.text.trim();
      const files = message.files ?? [];

      terminalStateNotifiedRef.current = false;
      manualHistorySeedRef.current = false;
      setThreadOverride(null);
      setExecutionStatus(null);
      lastErrorMessageRef.current = null;
      previousMessageCountRef.current = thread.messages.length;
      markLocalActiveRunOwnership(runThreadId);
      setOptimisticMessages(
        buildOptimisticMessages(text, files, t.uploads.uploadingFiles),
      );

      try {
        let uploadedFiles: UploadedFileInfo[] = [];
        const knowledgeAddCommand = isKnowledgeAddCommand(extraContext);

        if (files.length > 0) {
          try {
            if (knowledgeAddCommand) {
              const knowledgeFiles = await prepareFilesForUpload(files);
              if (knowledgeFiles.length === 0) {
                throw new Error(
                  "The /knowledge-add command requires at least one uploaded file.",
                );
              }
              await createThreadKnowledgeBase(runThreadId, {
                name:
                  typeof extraContext?.command_args === "string"
                    ? extraContext.command_args
                    : "",
                modelName: selectedModelName,
                files: knowledgeFiles,
              });
              setOptimisticMessages((messages) =>
                replaceOptimisticHumanFiles(
                  messages,
                  toIndexedKnowledgeFiles(knowledgeFiles),
                ),
              );
              await queryClient.invalidateQueries({
                queryKey: ["thread-knowledge-bases", runThreadId],
              });
            } else {
              uploadedFiles = await uploadPromptFiles(runThreadId, files);
              if (uploadedFiles.length > 0) {
                setOptimisticMessages((messages) =>
                  replaceOptimisticHumanFiles(
                    messages,
                    toUploadedFiles(uploadedFiles),
                  ),
                );
              }
            }
          } catch (error) {
            console.error("Failed to upload files:", error);
            notifyThreadError(error);
            setOptimisticMessages([]);
            clearLocalActiveRunOwnership(runThreadId);
            clearStoredActiveRunId(runThreadId);
            throw error;
          }
        }

        if (knowledgeAddCommand && files.length === 0) {
          throw new Error(
            "The /knowledge-add command requires at least one uploaded file.",
          );
        }

        primePendingThreadCaches(
          queryClient,
          runThreadId,
          resolvedContext,
          extraContext,
          text,
        );
        if (
          ensureRequestedThreadIdRef.current === runThreadId &&
          ensuredThreadIdRef.current !== runThreadId &&
          ensureThreadPromiseRef.current
        ) {
          await ensureThreadPromiseRef.current;
        }
        await thread.submit(
          buildSubmissionPayload(text, uploadedFiles),
          buildSubmitOptions(
            runThreadId,
            resolvedContext,
            selectedModelName,
            locale,
            extraContext,
          ),
        );
      } catch (error) {
        setOptimisticMessages([]);
        clearLocalActiveRunOwnership(runThreadId);
        clearStoredActiveRunId(runThreadId);
        notifyThreadError(error);
        throw error;
      }
    },
    [
      thread,
      locale,
      t.uploads.uploadingFiles,
      authenticated,
      notifyThreadError,
      queryClient,
      resolvedContext,
    ],
  );

  const historyContextWindow = useMemo(() => {
    const historySnapshot = historyEnabled
      ? getThreadHistorySnapshot(thread)
      : null;
    if (!historySnapshot) {
      return null;
    }

    return extractLatestContextWindow(historySnapshot) ?? null;
  }, [historyEnabled, thread]);

  const resumeInterrupt = useCallback(
    async (
      runThreadId: string,
      command: Command,
      extraContext?: Record<string, unknown>,
    ) => {
      if (!authenticated) {
        throw new Error("Authentication is required before resuming a run.");
      }

      const selectedModelName = requireModelName(resolvedContext);
      terminalStateNotifiedRef.current = false;
      manualHistorySeedRef.current = false;
      setThreadOverride(null);
      setExecutionStatus(null);
      lastErrorMessageRef.current = null;
      markLocalActiveRunOwnership(runThreadId);

      try {
        await thread.submit(null, {
          ...buildSubmitOptions(
            runThreadId,
            resolvedContext,
            selectedModelName,
            locale,
            extraContext,
            command,
          ),
          multitaskStrategy: "interrupt",
        });
      } catch (error) {
        clearLocalActiveRunOwnership(runThreadId);
        clearStoredActiveRunId(runThreadId);
        notifyThreadError(error);
        throw error;
      }
    },
    [
      authenticated,
      locale,
      notifyThreadError,
      queryClient,
      resolvedContext,
      thread,
    ],
  );

  const mergedThread = mergeOptimisticMessages(thread, optimisticMessages);
  const mergedThreadValues = useMemo(
    () =>
      historyContextWindow
        ? {
            ...mergedThread.values,
            context_window: historyContextWindow,
          }
        : mergedThread.values,
    [mergedThread.values, historyContextWindow],
  );
  const liveHistory = useMemo(() => {
    if (!historyEnabled) {
      return [];
    }

    return getThreadHistorySnapshot(thread);
  }, [historyEnabled, thread]);
  const stopRun = useCallback(async () => {
    if (stopPromiseRef.current) {
      await stopPromiseRef.current;
      return;
    }

    const activeRunTarget = resolveActiveRunTarget(threadId, streamThreadId);
    setExecutionStatus((current) =>
      finalizeExecutionStatus(current, {
        terminalEvent: "interrupted",
      }),
    );
    manualHistorySeedRef.current = false;
    setPendingRecoveryLoading(false);
    const snapshot = buildThreadOverride(
      "snapshot",
      mergedThreadValues,
      mergedThread.messages,
      liveHistory,
      mergedThread.interrupt as AgentInterrupt | undefined,
      getExperimentalBranchTree(thread),
    );
    setThreadOverride(snapshot);

    const stopPromise = (async () => {
      let latestState: AgentThreadState | null = snapshot.values;

      try {
        // reconnectOnMount is disabled, so the SDK will not retain the
        // runMetadataStorage it normally uses to issue server-side cancel.
        const cancelResult = await stopStreamingRun({
          stopStream: thread.stop,
          cancelRun: () =>
            activeRunTarget.threadId && activeRunTarget.runId
              ? apiClient.runs.cancel(
                  activeRunTarget.threadId,
                  activeRunTarget.runId,
                )
              : Promise.resolve(),
        });
        if (cancelResult.status === "rejected") {
          logRunCancelFailure(activeRunTarget, cancelResult.reason);
        }
      } catch (error) {
        notifyThreadError(error);
      } finally {
        clearActiveRunTarget(activeRunTarget);
      }

      if (!activeRunTarget.threadId || !authenticated) {
        setPendingRecoveryLoading(false);
        setHistoryEnabled(true);
        onStop?.(latestState);
        return;
      }

      try {
        const [state, history] = await Promise.all([
          apiClient.threads.getState<AgentThreadState>(
            activeRunTarget.threadId,
            undefined,
            {
              subgraphs: true,
            },
          ),
          apiClient.threads
            .getHistory<AgentThreadState>(activeRunTarget.threadId, {
              limit: HISTORY_PAGE_SIZE,
            })
            .catch(() => []),
        ]);

        latestState = state.values;
        manualHistorySeedRef.current = true;
        const nextThreadOverride = buildThreadOverrideFromState(
          "snapshot",
          state.values,
          history,
          extractPrimaryInterrupt(state),
          getExperimentalBranchTree(thread),
        );
        if (nextThreadOverride) {
          setThreadOverride(nextThreadOverride);
        }
      } catch (error) {
        manualHistorySeedRef.current = false;
        notifyThreadError(error);
      }

      setPendingRecoveryLoading(false);
      setHistoryEnabled(true);
      onStop?.(latestState);
      void invalidateThreadSearchCaches(queryClient);
    })().finally(() => {
      stopPromiseRef.current = null;
    });

    stopPromiseRef.current = stopPromise;
    await stopPromise;
  }, [
    apiClient.runs,
    apiClient.threads,
    authenticated,
    liveHistory,
    mergedThread.messages,
    mergedThreadValues,
    notifyThreadError,
    onStop,
    queryClient,
    streamThreadId,
    thread,
    threadId,
  ]);
  const effectiveMessages = threadOverride?.messages ?? mergedThread.messages;
  const effectiveValues = threadOverride?.values ?? mergedThreadValues;
  const effectiveHistory = threadOverride?.history ?? liveHistory;
  const effectiveInterrupt =
    threadOverride !== null ? threadOverride.interrupt : mergedThread.interrupt;
  const enrichedThread = useMemo(
    () =>
      cloneThreadStream(mergedThread, {
        values: effectiveValues,
        messages: effectiveMessages,
        interrupt: effectiveInterrupt,
        isLoading: mergedThread.isLoading || pendingRecoveryLoading,
        history: historyEnabled
          ? effectiveHistory
          : (threadOverride?.history ?? []),
        experimental_branchTree: historyEnabled
          ? (threadOverride?.experimental_branchTree ??
            getExperimentalBranchTree(mergedThread))
          : undefined,
        stop: stopRun,
      }),
    [
      effectiveHistory,
      effectiveInterrupt,
      effectiveMessages,
      effectiveValues,
      historyEnabled,
      mergedThread,
      pendingRecoveryLoading,
      stopRun,
      threadOverride?.experimental_branchTree,
      threadOverride?.history,
    ],
  );

  return [
    enrichedThread,
    sendMessage,
    resumeInterrupt,
    isThreadReady,
    executionStatus,
  ] as const;
}
