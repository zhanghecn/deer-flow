import type { AIMessage, Command, Message } from "@langchain/langgraph-sdk";
import { useStream } from "@langchain/langgraph-sdk/react";
import { useQueryClient } from "@tanstack/react-query";
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

import type { AgentInterruptValue, AgentThreadState } from "./types";

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
  onToolEnd?: (event: ToolEndEvent) => void;
};

const LEAD_AGENT_ID = "lead_agent";
const FLASH_STREAM_THROTTLE = 96;
const DEFAULT_STREAM_THROTTLE = 192;
const HISTORY_PAGE_SIZE = 1;
const STREAM_RECURSION_LIMIT = 1000;
const THREAD_SEARCH_QUERY_KEY = ["threads", "search"] as const;
const STREAM_MODES = ["values", "messages-tuple", "custom"] as const;

function resolveThreadContext(context: ThreadContext): ThreadContext {
  const storedContext = getLocalSettings().context;

  return {
    ...context,
    model_name: context.model_name ?? storedContext.model_name,
    mode: context.mode ?? storedContext.mode,
    reasoning_effort:
      context.reasoning_effort ?? storedContext.reasoning_effort,
    agent_name: context.agent_name ?? storedContext.agent_name,
    agent_status: context.agent_status ?? storedContext.agent_status,
    execution_backend:
      context.execution_backend ?? storedContext.execution_backend,
    remote_session_id:
      context.remote_session_id ?? storedContext.remote_session_id,
  };
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
  return context.mode === "flash"
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
        thinking_enabled: context.mode !== "flash",
        is_plan_mode: context.mode === "pro" || context.mode === "ultra",
        subagent_enabled: context.mode === "ultra",
        thread_id: threadId,
      },
    },
    command,
  };
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

export function useThreadStream({
  threadId,
  context,
  isMock,
  skipInitialHistory = false,
  onStart,
  onFinish,
  onToolEnd,
}: ThreadStreamOptions) {
  const { t } = useI18n();
  const { authenticated } = useAuth();
  const apiClient = getAPIClient(isMock);
  const [streamThreadId, setStreamThreadId] = useState<string | null>(null);
  const [historyEnabled, setHistoryEnabled] = useState(
    () => !!threadId && !skipInitialHistory,
  );
  const hasStartedStreamRef = useRef(false);
  const previousThreadIdRef = useRef<string | null | undefined>(threadId);
  const resolvedContext = useMemo(
    () => resolveThreadContext(context),
    [context],
  );
  const streamThrottle = resolveStreamThrottle(resolvedContext);

  useEffect(() => {
    let cancelled = false;
    const previousThreadId = previousThreadIdRef.current;
    const createdThreadDuringCurrentSession =
      !previousThreadId && !!threadId && hasStartedStreamRef.current;

    hasStartedStreamRef.current = false;
    previousThreadIdRef.current = threadId;
    setHistoryEnabled(
      threadId
        ? !(createdThreadDuringCurrentSession || skipInitialHistory)
        : false,
    );

    if (!threadId || !authenticated) {
      setStreamThreadId(null);
      return () => {
        cancelled = true;
      };
    }

    setStreamThreadId(null);
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
      })
      .finally(() => {
        if (!cancelled) {
          setStreamThreadId(threadId);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [threadId, authenticated, apiClient, skipInitialHistory]);

  const queryClient = useQueryClient();
  const updateSubtask = useUpdateSubtask();
  const thread = useStream<
    AgentThreadState,
    { InterruptType: AgentInterruptValue }
  >({
    client: apiClient,
    assistantId: LEAD_AGENT_ID,
    threadId: streamThreadId,
    throttle: streamThrottle,
    reconnectOnMount: true,
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
        setHistoryEnabled(true);
      }
      onFinish?.(state.values);
      void queryClient.invalidateQueries({
        queryKey: THREAD_SEARCH_QUERY_KEY,
      });
    },
  });

  const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([]);
  const previousMessageCountRef = useRef(thread.messages.length);
  const isThreadReady = !threadId || streamThreadId === threadId;

  useEffect(() => {
    if (
      optimisticMessages.length > 0 &&
      thread.messages.length > previousMessageCountRef.current
    ) {
      setOptimisticMessages([]);
    }
  }, [thread.messages.length, optimisticMessages.length]);

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
            const errorMessage =
              error instanceof Error
                ? error.message
                : "Failed to upload files.";
            toast.error(errorMessage);
            setOptimisticMessages([]);
            throw error;
          }
        }

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

      await thread.submit(
        null,
        {
          ...buildSubmitOptions(
            runThreadId,
            resolvedContext,
            selectedModelName,
            extraContext,
            command,
          ),
          multitaskStrategy: "interrupt",
        },
      );

      void queryClient.invalidateQueries({
        queryKey: THREAD_SEARCH_QUERY_KEY,
      });
    },
    [authenticated, queryClient, resolvedContext, thread],
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
  const enrichedThread = useMemo(
    () =>
      cloneThreadStream(mergedThread, {
        values: mergedThreadValues,
        ...(historyEnabled
          ? {}
          : {
              history: [],
              experimental_branchTree: undefined,
            }),
      }),
    [mergedThread, mergedThreadValues, historyEnabled],
  );

  return [enrichedThread, sendMessage, resumeInterrupt, isThreadReady] as const;
}
