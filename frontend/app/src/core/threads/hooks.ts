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
  AgentThread,
  AgentThreadState,
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
const STREAM_MODES = ["values", "messages-tuple", "custom"] as const;
type ThreadOverride = {
  values: AgentThreadState;
  messages: Message[];
  history: ThreadState<AgentThreadState>[];
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

function buildThreadOverride(
  values: AgentThreadState,
  messages: Message[],
  history: ThreadState<AgentThreadState>[],
  experimental_branchTree?: unknown,
): ThreadOverride {
  return {
    values,
    messages,
    history,
    experimental_branchTree,
  };
}

function extractThreadMessages(values: AgentThreadState): Message[] {
  return Array.isArray(values.messages) ? values.messages : [];
}

function buildThreadOverrideFromState(
  values: AgentThreadState,
  history: ThreadState<AgentThreadState>[],
  experimentalBranchTree?: unknown,
): ThreadOverride | null {
  const messages = extractThreadMessages(values);
  if (messages.length === 0) {
    return null;
  }

  return buildThreadOverride(values, messages, history, experimentalBranchTree);
}

function getExperimentalBranchTree(source: object) {
  if (!("experimental_branchTree" in source)) {
    return undefined;
  }

  return (source as { experimental_branchTree?: unknown })
    .experimental_branchTree;
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
  const { t } = useI18n();
  const { authenticated } = useAuth();
  const apiClient = getAPIClient(isMock, threadId ?? null);
  const { isActive: isWindowActive, activationId: windowActivationId } =
    useWindowActivity();
  const [streamThreadId, setStreamThreadId] = useState<string | null>(
    () => threadId ?? null,
  );
  const [threadOverride, setThreadOverride] = useState<ThreadOverride | null>(
    null,
  );
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
  const stopPromiseRef = useRef<Promise<void> | null>(null);
  const resolvedContext = useMemo(
    () => resolveThreadContext(context),
    [context],
  );
  const streamThrottle = resolveStreamThrottle(resolvedContext);
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
      setStreamThreadId(null);
      return;
    }

    setStreamThreadId(threadId);
    if (createdThreadDuringCurrentSession) {
      return;
    }

    void apiClient.threads
      .create({
        threadId,
        ifExists: "do_nothing",
        graphId: LEAD_AGENT_ID,
      })
      .catch((error) => {
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
  const thread = useStream<
    AgentThreadState,
    { InterruptType: AgentInterruptValue }
  >({
    client: apiClient,
    assistantId: LEAD_AGENT_ID,
    threadId: streamThreadId,
    throttle: streamThrottle,
    reconnectOnMount: isWindowActive,
    thread: passthroughThreadHistory,
    // Fresh threads can race with the first run before the runtime model is
    // persisted. Delay history reads until the first turn finishes.
    fetchStateHistory: historyEnabled ? { limit: HISTORY_PAGE_SIZE } : false,
    onCreated(meta) {
      setStreamThreadId(meta.thread_id);
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
      if (streamThreadId) {
        deferStateHydrationRef.current = false;
        lastHydrationActivationRef.current = null;
        setHistoryEnabled(true);
      }
      lastErrorMessageRef.current = null;
      onFinish?.(state.values);
      void queryClient.invalidateQueries({
        queryKey: THREAD_SEARCH_QUERY_KEY,
      });
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
    joinedRunIdRef.current = null;
    lastHydrationActivationRef.current = null;
    stateHydrationInFlightRef.current = false;
  }, [threadId]);

  useEffect(() => {
    if (!thread.error) {
      lastErrorMessageRef.current = null;
      return;
    }

    notifyThreadError(thread.error);
  }, [notifyThreadError, thread.error]);

  useEffect(() => {
    const shouldRefreshFromActivation =
      lastHydrationActivationRef.current !== windowActivationId;
    const shouldDeferStateHydration =
      deferStateHydrationRef.current && !historyEnabled;

    if (!threadId || !authenticated || !isWindowActive) {
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
            state.values,
            [],
          );
          if (!nextThreadOverride) {
            return;
          }

          setThreadOverride(nextThreadOverride);

          const activeRunId =
            typeof state.metadata?.run_id === "string"
              ? state.metadata.run_id
              : null;
          const shouldJoinPendingRun =
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
            void joinStream(activeRunId).catch((error: unknown) => {
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
    historyEnabled,
    isWindowActive,
    notifyThreadError,
    threadId,
    windowActivationId,
  ]);

  useEffect(() => {
    if (
      optimisticMessages.length > 0 &&
      threadMessageCount > previousMessageCountRef.current
    ) {
      setOptimisticMessages([]);
    }
  }, [threadMessageCount, optimisticMessages.length]);

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

      setThreadOverride(null);
      lastErrorMessageRef.current = null;
      previousMessageCountRef.current = thread.messages.length;
      setOptimisticMessages(
        buildOptimisticMessages(text, files, t.uploads.uploadingFiles),
      );

      try {
        let uploadedFiles: UploadedFileInfo[] = [];

        if (files.length > 0) {
          try {
            uploadedFiles = await uploadPromptFiles(runThreadId, files);
            if (uploadedFiles.length > 0) {
              setOptimisticMessages((messages) =>
                replaceOptimisticHumanFiles(
                  messages,
                  toUploadedFiles(uploadedFiles),
                ),
              );
            }
          } catch (error) {
            console.error("Failed to upload files:", error);
            notifyThreadError(error);
            setOptimisticMessages([]);
            throw error;
          }
        }

        primePendingThreadCaches(
          queryClient,
          runThreadId,
          resolvedContext,
          extraContext,
          text,
        );
        await thread.submit(
          buildSubmissionPayload(text, uploadedFiles),
          buildSubmitOptions(
            runThreadId,
            resolvedContext,
            selectedModelName,
            extraContext,
          ),
        );
        void queryClient.invalidateQueries({
          queryKey: THREAD_SEARCH_QUERY_KEY,
        });
      } catch (error) {
        setOptimisticMessages([]);
        notifyThreadError(error);
        throw error;
      }
    },
    [
      thread,
      t.uploads.uploadingFiles,
      authenticated,
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
      setThreadOverride(null);
      lastErrorMessageRef.current = null;

      try {
        await thread.submit(null, {
          ...buildSubmitOptions(
            runThreadId,
            resolvedContext,
            selectedModelName,
            extraContext,
            command,
          ),
          multitaskStrategy: "interrupt",
        });
      } catch (error) {
        notifyThreadError(error);
        throw error;
      }

      void queryClient.invalidateQueries({
        queryKey: THREAD_SEARCH_QUERY_KEY,
      });
    },
    [authenticated, notifyThreadError, queryClient, resolvedContext, thread],
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
    const snapshot = buildThreadOverride(
      mergedThreadValues,
      mergedThread.messages,
      liveHistory,
      getExperimentalBranchTree(thread),
    );
    setThreadOverride(snapshot);

    const stopPromise = (async () => {
      let latestState: AgentThreadState | null = snapshot.values;

      try {
        await thread.stop();
      } catch (error) {
        notifyThreadError(error);
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
          state.values,
          history,
          getExperimentalBranchTree(thread),
        );
        if (nextThreadOverride) {
          setThreadOverride(nextThreadOverride);
        }
      } catch (error) {
        notifyThreadError(error);
      }

      onStop?.(latestState);
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
    streamThreadId,
    thread,
    threadId,
  ]);
  const effectiveMessages = threadOverride?.messages ?? mergedThread.messages;
  const effectiveValues = threadOverride?.values ?? mergedThreadValues;
  const effectiveHistory = threadOverride?.history ?? liveHistory;
  const enrichedThread = useMemo(
    () =>
      cloneThreadStream(mergedThread, {
        values: effectiveValues,
        messages: effectiveMessages,
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
      effectiveMessages,
      effectiveValues,
      historyEnabled,
      mergedThread,
      stopRun,
      threadOverride?.experimental_branchTree,
      threadOverride?.history,
    ],
  );

  return [enrichedThread, sendMessage, resumeInterrupt, isThreadReady] as const;
}
