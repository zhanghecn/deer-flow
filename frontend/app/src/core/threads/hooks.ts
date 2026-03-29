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

import { normalizeThreadError } from "./error";
import {
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
  RetryStatus,
  RetryStatusEvent,
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
const STREAM_RECURSION_LIMIT = 1000;
const STATE_HYDRATION_DELAY_MS = process.env.NODE_ENV === "test" ? 0 : 1500;
const PENDING_RUN_RECOVERY_POLL_MS =
  process.env.NODE_ENV === "test" ? 25 : 2000;
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

function resolveThreadContext(context: ThreadContext): ThreadContext {
  const storedContext = getLocalSettings().context;
  const mode = normalizeThreadMode(context.mode ?? storedContext.mode);

  return {
    ...context,
    model_name: context.model_name ?? storedContext.model_name,
    mode,
    reasoning_effort:
      context.reasoning_effort ??
      storedContext.reasoning_effort ??
      (mode ? getReasoningEffortForMode(mode) : undefined),
    agent_name: context.agent_name ?? storedContext.agent_name,
    agent_status: context.agent_status ?? storedContext.agent_status,
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
  const submitFlags = resolveSubmitFlags(context.mode);

  return {
    threadId,
    streamSubgraphs: true,
    streamResumable: true,
    streamMode: [...STREAM_MODES],
    config: {
      recursion_limit: STREAM_RECURSION_LIMIT,
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

  return (source as { experimental_branchTree?: unknown })
    .experimental_branchTree;
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

function isRetryStatusEvent(event: unknown): event is RetryStatusEvent {
  if (!event || typeof event !== "object") {
    return false;
  }

  return (
    "type" in event &&
    event.type === "retry_status" &&
    "scope" in event &&
    (event.scope === "model" || event.scope === "tool") &&
    "status" in event &&
    (event.status === "retrying" ||
      event.status === "completed" ||
      event.status === "failed") &&
    "retry_count" in event &&
    typeof event.retry_count === "number" &&
    "max_retries" in event &&
    typeof event.max_retries === "number" &&
    "occurred_at" in event &&
    typeof event.occurred_at === "string"
  );
}

function toRetryStatus(event: RetryStatusEvent): RetryStatus {
  return {
    scope: event.scope,
    retry_count: event.retry_count,
    max_retries: event.max_retries,
    occurred_at: event.occurred_at,
    next_retry_at: event.next_retry_at,
    delay_seconds: event.delay_seconds,
    tool_name: event.tool_name,
    error: event.error,
    error_type: event.error_type,
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
  const [retryStatus, setRetryStatus] = useState<RetryStatus | null>(null);
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
      const message = normalizeThreadError(error);
      setRetryStatus(null);
      if (lastErrorMessageRef.current === message) {
        return message;
      }

      lastErrorMessageRef.current = message;
      toast.error(message);
      onError?.(message);
      return message;
    },
    [onError],
  );
  const finalizeRecoveredRun = useCallback(
    (state: AgentThreadState, resolvedThreadId?: string | null) => {
      if (terminalStateNotifiedRef.current) {
        return;
      }

      terminalStateNotifiedRef.current = true;
      setRetryStatus(null);
      const activeThreadId = resolvedThreadId ?? streamThreadId ?? threadId;
      clearLocalActiveRunOwnership(activeThreadId);
      clearStoredActiveRunId(activeThreadId);
      if (activeThreadId) {
        deferStateHydrationRef.current = false;
        lastHydrationActivationRef.current = null;
        setHistoryEnabled(true);
      }
      lastErrorMessageRef.current = null;
      onFinish?.(state);
      void invalidateThreadSearchCaches(queryClient);
    },
    [onFinish, queryClient, streamThreadId, threadId],
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
    fetchStateHistory: historyEnabled ? { limit: HISTORY_PAGE_SIZE } : false,
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
      if (isRetryStatusEvent(event)) {
        if (event.status === "retrying") {
          setRetryStatus(toRetryStatus(event));
        } else {
          setRetryStatus(null);
        }
        return;
      }

      if (
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "task_running"
      ) {
        const e = event as {
          type: "task_running";
          task_id: string;
          message: AIMessage;
        };
        updateSubtask({ id: e.task_id, latestMessage: e.message });
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

  joinStreamRef.current = thread.joinStream;
  threadLoadingRef.current = thread.isLoading;

  useEffect(() => {
    setThreadOverride(null);
    setRetryStatus(null);
    joinedRunIdRef.current = null;
    lastHydrationActivationRef.current = null;
    stateHydrationInFlightRef.current = false;
    terminalStateNotifiedRef.current = false;
  }, [threadId]);

  useEffect(() => {
    if (!thread.error) {
      lastErrorMessageRef.current = null;
      return;
    }

    notifyThreadError(thread.error);
  }, [notifyThreadError, thread.error]);

  useEffect(() => {
    if (!thread.isLoading) {
      setRetryStatus(null);
    }
  }, [thread.isLoading]);

  useEffect(() => {
    if (!threadId || !authenticated || thread.isLoading) {
      return;
    }

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
    void joinStream(activeRunId, undefined, {
      streamMode: [...STREAM_MODES],
    }).catch((error: unknown) => {
      joinedRunIdRef.current = null;
      notifyThreadError(error);
    });
  }, [authenticated, notifyThreadError, thread.isLoading, threadId]);

  useEffect(() => {
    const shouldRefreshFromActivation =
      lastHydrationActivationRef.current !== windowActivationId;
    const shouldDeferStateHydration =
      deferStateHydrationRef.current && !historyEnabled;

    if (!threadId || !authenticated || !isWindowActive) {
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
          if (!nextThreadOverride) {
            return;
          }

          setThreadOverride(nextThreadOverride);

          const activeRunId =
            typeof state.metadata?.run_id === "string"
              ? state.metadata.run_id
              : null;
          const allowLocalRunResume = hasLocalActiveRunOwnership(threadId);
          const shouldJoinPendingRun =
            allowLocalRunResume &&
            !threadLoadingRef.current &&
            Array.isArray(state.next) &&
            state.next.length > 0 &&
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
    hasResolvedModelName,
    historyEnabled,
    isWindowActive,
    notifyThreadError,
    threadId,
    windowActivationId,
  ]);

  useEffect(() => {
    if (
      !threadId ||
      !authenticated ||
      historyEnabled ||
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

          const stateMessages = extractThreadMessages(state.values);
          if (stateMessages.length === 0) {
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
    finalizeRecoveredRun,
    hasResolvedModelName,
    historyEnabled,
    isWindowActive,
    thread,
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
      setThreadOverride(null);
      setRetryStatus(null);
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
    const historySnapshot = historyEnabled ? thread.history : null;
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
      setThreadOverride(null);
      setRetryStatus(null);
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

    return thread.history;
  }, [historyEnabled, thread]);
  const stopRun = useCallback(async () => {
    if (stopPromiseRef.current) {
      await stopPromiseRef.current;
      return;
    }

    const activeThreadId = threadId ?? streamThreadId;
    setRetryStatus(null);
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
        await thread.stop();
      } catch (error) {
        notifyThreadError(error);
      } finally {
        clearLocalActiveRunOwnership(activeThreadId);
        clearStoredActiveRunId(activeThreadId);
      }

      setHistoryEnabled(true);

      if (!activeThreadId || !authenticated) {
        onStop?.(latestState);
        return;
      }

      try {
        const [state, history] = await Promise.all([
          apiClient.threads.getState<AgentThreadState>(
            activeThreadId,
            undefined,
            {
              subgraphs: true,
            },
          ),
          apiClient.threads
            .getHistory<AgentThreadState>(activeThreadId, {
              limit: HISTORY_PAGE_SIZE,
            })
            .catch(() => []),
        ]);

        latestState = state.values;
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
        notifyThreadError(error);
      }

      onStop?.(latestState);
      void invalidateThreadSearchCaches(queryClient);
    })().finally(() => {
      stopPromiseRef.current = null;
    });

    stopPromiseRef.current = stopPromise;
    await stopPromise;
  }, [
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
    retryStatus,
  ] as const;
}
