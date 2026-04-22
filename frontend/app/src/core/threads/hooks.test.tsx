import type { Message, ThreadState } from "@langchain/langgraph-sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import type { LocalSettings } from "@/core/settings";

import { useThreadStream } from "./hooks";
import {
  buildThreadRuntimeQueryKey,
  buildThreadSearchQueryKey,
  DEFAULT_THREAD_SEARCH_PARAMS,
  THREAD_SEARCH_QUERY_KEY,
} from "./search";
import type { AgentThread, AgentThreadState } from "./types";

type MockThreadState = {
  values: AgentThreadState;
  messages: Message[];
  history: ThreadState<AgentThreadState>[];
  error: unknown;
  interrupt: undefined;
  isLoading: boolean;
  isThreadLoading: boolean;
  joinStream: ReturnType<typeof vi.fn>;
  submit: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

const subscribers = new Set<() => void>();
const toastError = vi.fn();
const updateSubtask = vi.fn();
const getAPIClientMock = vi.fn();
let mockLocalSettingsContext: LocalSettings["context"] = {
  model_name: "kimi-k2.5",
  mode: "pro",
  effort: "high",
  agent_status: "dev",
};
const apiClient = {
  threads: {
    create: vi.fn(),
    getState: vi.fn(),
    getHistory: vi.fn(),
  },
  runs: {
    cancel: vi.fn(),
  },
};

let streamState: MockThreadState;
let latestUseStreamOptions: Record<string, unknown> | null;

function createPendingPromise<T>() {
  return new Promise<T>(() => undefined);
}

function makeThreadState(
  overrides: Partial<MockThreadState> = {},
): MockThreadState {
  const values: AgentThreadState = {
    title: "Thread",
    messages: [],
    artifacts: [],
  };

  return {
    values,
    messages: values.messages,
    history: [],
    error: undefined,
    interrupt: undefined,
    isLoading: false,
    isThreadLoading: false,
    joinStream: vi.fn().mockResolvedValue(undefined),
    submit: vi.fn(),
    stop: vi.fn(),
    ...overrides,
  };
}

function emitStream(partial: Partial<MockThreadState>) {
  streamState = {
    ...streamState,
    ...partial,
  };
  for (const subscriber of subscribers) {
    subscriber();
  }
}

vi.mock("@langchain/langgraph-sdk/react", () => ({
  useStream: (options: unknown) => {
    latestUseStreamOptions = options as Record<string, unknown>;
    const [, setTick] = React.useState(0);

    React.useEffect(() => {
      const subscriber = () => setTick((value) => value + 1);
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    }, []);

    return streamState;
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
  },
}));

vi.mock("../api", () => ({
  getAPIClient: (...args: unknown[]) => getAPIClientMock(...args),
}));

vi.mock("../auth/hooks", () => ({
  useAuth: () => ({
    authenticated: true,
  }),
}));

vi.mock("../i18n/hooks", () => ({
  useI18n: () => ({
    t: {
      uploads: {
        uploadingFiles: "Uploading files...",
      },
    },
  }),
}));

vi.mock("../settings", () => ({
  getLocalSettings: () => ({
    notification: { enabled: true },
    layout: { sidebar_collapsed: false },
    context: mockLocalSettingsContext,
  }),
}));

vi.mock("../tasks/context", () => ({
  useUpdateSubtask: () => updateSubtask,
}));

vi.mock("../uploads", () => ({
  uploadFiles: vi.fn(),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  return Object.assign(Wrapper, { queryClient });
}

describe("useThreadStream", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    subscribers.clear();
    latestUseStreamOptions = null;
    getAPIClientMock.mockReset().mockReturnValue(apiClient);
    mockLocalSettingsContext = {
      model_name: "kimi-k2.5",
      mode: "pro",
      effort: "high",
      agent_status: "dev",
    };
    toastError.mockReset();
    updateSubtask.mockReset();
    window.sessionStorage.clear();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    apiClient.threads.create.mockReset().mockResolvedValue(undefined);
    apiClient.threads.getState.mockReset().mockResolvedValue({
      values: {
        title: "Thread",
        messages: [],
        artifacts: [],
      },
    });
    apiClient.threads.getHistory.mockReset().mockResolvedValue([]);
    apiClient.runs.cancel.mockReset().mockResolvedValue(undefined);
    streamState = makeThreadState();
  });

  it("passes the resolved runtime identity to the LangGraph API client", () => {
    renderHook(
      () =>
        useThreadStream({
          threadId: "thread-identity",
          context: {
            thread_id: "thread-identity",
            model_name: "selected-model",
            mode: "pro",
            thinking_enabled: true,
            is_plan_mode: false,
            subagent_enabled: true,
          },
        }),
      { wrapper: createWrapper() },
    );

    expect(getAPIClientMock).toHaveBeenCalledWith(
      undefined,
      "thread-identity",
      expect.objectContaining({
        model_name: "selected-model",
        agent_status: "dev",
      }),
    );
  });

  it("does not restore a stored model name when the caller clears it explicitly", () => {
    mockLocalSettingsContext = {
      model_name: "kimi-k2.5-1",
      mode: "pro",
      effort: "high",
      agent_status: "dev",
    };

    renderHook(
      () =>
        useThreadStream({
          threadId: "thread-identity",
          context: {
            model_name: undefined,
            agent_name: "contract-agent",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    expect(getAPIClientMock).toHaveBeenCalledWith(
      undefined,
      "thread-identity",
      expect.objectContaining({
        agent_name: "contract-agent",
        model_name: undefined,
      }),
    );
  });

  it("skips state hydration for pending threads until a model is resolved", async () => {
    mockLocalSettingsContext = {
      model_name: undefined,
      mode: "pro",
      effort: "high",
      agent_status: "dev",
    };

    renderHook(
      () =>
        useThreadStream({
          threadId: "thread-pending",
          context: {
            model_name: undefined,
            agent_status: "dev",
            mode: "pro",
          },
          skipInitialHistory: true,
        }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(apiClient.threads.getState).not.toHaveBeenCalled();
  });

  it("surfaces stream errors through a toast once per distinct message", async () => {
    window.sessionStorage.setItem("openagents:stream-owner:thread-1", "1");

    renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    act(() => {
      emitStream({
        error: new Error("Connection error"),
      });
    });

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        "Connection error",
        expect.objectContaining({
          id: expect.stringContaining("thread-1"),
        }),
      );
    });

    act(() => {
      emitStream({
        error: new Error("Connection error"),
      });
    });

    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("keeps local cancellation errors silent", async () => {
    const onError = vi.fn();
    window.sessionStorage.setItem("openagents:stream-owner:thread-1", "1");

    renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
          onError,
        }),
      { wrapper: createWrapper() },
    );

    act(() => {
      emitStream({
        error: "CancelledError()",
      });
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(toastError).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not replay the last persisted run error when reopening a thread", async () => {
    streamState = makeThreadState({
      error: "APIConnectionError('Connection error.')",
      history: [
        {
          values: {
            title: "Thread",
            messages: [
              {
                type: "human",
                id: "human-1",
                content: "hello",
              },
            ],
            artifacts: [],
          },
          tasks: [{ error: "APIConnectionError('Connection error.')" }],
        } as unknown as ThreadState<AgentThreadState>,
      ],
    });

    renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(toastError).not.toHaveBeenCalled();
  });

  it("replays persisted actionable errors when reopening a thread", async () => {
    const rateLimitError =
      "RateLimitError('Error code: 429 - {\\'error\\': {\\'message\\': \"We\\'re receiving too many requests right now.\"}, \\'type\\': \\'error\\'}')";

    const { result } = renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    streamState = makeThreadState({
      history: [
        {
          values: {
            title: "Thread",
            messages: [
              {
                type: "human",
                id: "human-1",
                content: "hello",
              },
            ],
            artifacts: [],
          },
          tasks: [
            {
              error: rateLimitError,
            },
          ],
        } as unknown as ThreadState<AgentThreadState>,
      ],
    });

    act(() => {
      emitStream(streamState);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(toastError).toHaveBeenCalledWith(
      "429 We're receiving too many requests right now.",
      expect.objectContaining({
        id: expect.stringContaining("thread-1"),
      }),
    );
    expect(result.current[4]).toMatchObject({
      event: "failed",
      phase_kind: "run",
      error: "429 We're receiving too many requests right now.",
      terminal: true,
    });
  });

  it("does not replay the same persisted actionable error twice while hydration is loading", async () => {
    const rateLimitError =
      "RateLimitError('Error code: 429 - {\\'error\\': {\\'message\\': \"We\\'re receiving too many requests right now.\"}, \\'type\\': \\'error\\'}')";

    streamState = makeThreadState({
      isLoading: true,
    });

    renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    act(() => {
      emitStream({
        isLoading: true,
        history: [
          {
            values: {
              title: "Thread",
              messages: [
                {
                  type: "human",
                  id: "human-1",
                  content: "hello",
                },
              ],
              artifacts: [],
            },
            tasks: [{ error: rateLimitError }],
          } as unknown as ThreadState<AgentThreadState>,
        ],
      });
    });

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledTimes(1);
    });

    act(() => {
      emitStream({
        isLoading: true,
        history: [],
      });
    });

    act(() => {
      emitStream({
        isLoading: true,
        history: [
          {
            values: {
              title: "Thread",
              messages: [
                {
                  type: "human",
                  id: "human-1",
                  content: "hello",
                },
              ],
              artifacts: [],
            },
            tasks: [{ error: rateLimitError }],
          } as unknown as ThreadState<AgentThreadState>,
        ],
      });
    });

    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("surfaces submit failures to the user", async () => {
    streamState.submit.mockRejectedValueOnce(
      new Error("429 Too Many Requests"),
    );

    const { result } = renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    const message: PromptInputMessage = {
      text: "hello",
      files: [],
    };

    await act(async () => {
      await expect(result.current[1]("thread-1", message)).rejects.toThrow(
        "429 Too Many Requests",
      );
    });

    expect(toastError).toHaveBeenCalledWith(
      "429 Too Many Requests",
      expect.objectContaining({
        id: expect.stringContaining("thread-1"),
      }),
    );
  });

  it("tracks unified execution progress from custom stream events", async () => {
    const { result } = renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    const onCustomEvent = latestUseStreamOptions?.onCustomEvent;
    expect(typeof onCustomEvent).toBe("function");
    if (typeof onCustomEvent !== "function") {
      throw new Error("Expected onCustomEvent callback to be registered.");
    }

    act(() => {
      onCustomEvent({
        type: "execution_event",
        event: "phase_started",
        occurred_at: "2026-03-23T12:00:00Z",
        started_at: "2026-03-23T12:00:00Z",
        phase: "thinking_initial",
        phase_kind: "model",
      });
    });

    expect(result.current[4]).toEqual({
      event: "phase_started",
      phase: "thinking_initial",
      phase_kind: "model",
      started_at: "2026-03-23T12:00:00Z",
      run_started_at: "2026-03-23T12:00:00Z",
      tool_name: undefined,
      terminal: false,
    });

    act(() => {
      onCustomEvent({
        type: "execution_event",
        event: "retrying",
        occurred_at: "2026-03-23T12:00:01Z",
        started_at: "2026-03-23T12:00:01Z",
        phase: "retry_wait",
        phase_kind: "retry",
        retry_count: 2,
        max_retries: 5,
        delay_seconds: 1,
        error: "429 Too Many Requests",
      });
    });

    expect(result.current[4]).toEqual({
      event: "retrying",
      phase: "retry_wait",
      phase_kind: "retry",
      started_at: "2026-03-23T12:00:01Z",
      run_started_at: "2026-03-23T12:00:00Z",
      finished_at: undefined,
      tool_name: undefined,
      retry_count: 2,
      max_retries: 5,
      delay_seconds: 1,
      error: "429 Too Many Requests",
      error_type: undefined,
      terminal: false,
    });

    act(() => {
      onCustomEvent({
        type: "execution_event",
        event: "retry_completed",
        retry_count: 2,
        max_retries: 5,
        occurred_at: "2026-03-23T12:00:02Z",
        started_at: "2026-03-23T12:00:02Z",
        phase: "retry_wait",
      });
    });

    expect(result.current[4]).toEqual({
      event: "retry_completed",
      phase: "retry_wait",
      phase_kind: "retry",
      started_at: "2026-03-23T12:00:02Z",
      run_started_at: "2026-03-23T12:00:00Z",
      finished_at: undefined,
      tool_name: undefined,
      retry_count: 2,
      max_retries: 5,
      delay_seconds: undefined,
      error: undefined,
      error_type: undefined,
      terminal: false,
    });
  });

  it("surfaces hydrated interrupts from thread state recovery", async () => {
    apiClient.threads.getState.mockResolvedValue({
      values: {
        title: "Thread",
        messages: [
          {
            type: "human",
            id: "human-1",
            content: "帮我整理案例",
          },
          {
            type: "ai",
            id: "ai-1",
            content: "需要进一步确认范围。",
          },
        ],
        artifacts: [],
      },
      interrupts: [
        {
          id: "question-1",
          value: {
            kind: "question",
            request_id: "question-1",
            questions: [
              {
                header: "Scope",
                question: "Which source set should I prioritize?",
                options: [{ label: "Public web only" }],
                multiple: false,
                custom: true,
              },
            ],
          },
        },
      ],
      next: ["tools"],
    });

    const { result } = renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
          skipInitialHistory: true,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current[0].interrupt).toEqual({
        id: "question-1",
        value: {
          kind: "question",
          request_id: "question-1",
          questions: [
            {
              header: "Scope",
              question: "Which source set should I prioritize?",
              options: [{ label: "Public web only" }],
              multiple: false,
              custom: true,
            },
          ],
        },
      });
    });
  });

  it("routes task_running custom events through the typed runtime event path", () => {
    const { result } = renderHook(
      () =>
        useThreadStream({
          threadId: "thread-task-running",
          context: {
            thread_id: "thread-task-running",
            model_name: "selected-model",
            mode: "pro",
            thinking_enabled: true,
            is_plan_mode: false,
            subagent_enabled: true,
          },
        }),
      { wrapper: createWrapper() },
    );

    const onCustomEvent = latestUseStreamOptions?.onCustomEvent;
    expect(typeof onCustomEvent).toBe("function");
    if (typeof onCustomEvent !== "function") {
      throw new Error("Expected onCustomEvent callback to be registered.");
    }

    const message = {
      type: "ai",
      id: "ai-task-1",
      content: "still running",
    } as Message;

    act(() => {
      onCustomEvent({
        type: "task_running",
        task_id: "task-1",
        message,
      });
    });

    expect(result.current[4]).toBeNull();
    expect(updateSubtask).toHaveBeenCalledWith({
      id: "task-1",
      latestMessage: message,
    });
  });

  it("adds a pending thread to the sidebar cache before a run finishes", async () => {
    const wrapper = createWrapper();
    wrapper.queryClient.setQueryData(
      buildThreadSearchQueryKey(DEFAULT_THREAD_SEARCH_PARAMS),
      [],
    );
    streamState.submit.mockImplementation(() => createPendingPromise<void>());

    const { result } = renderHook(
      () =>
        useThreadStream({
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper },
    );

    await act(async () => {
      void result.current[1]("thread-pending", {
        text: "Draft the launch checklist",
        files: [],
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      const cachedThreads = wrapper.queryClient.getQueryData<{
        items: AgentThread[];
      }>(
        buildThreadSearchQueryKey(DEFAULT_THREAD_SEARCH_PARAMS),
      );
      expect(cachedThreads).toMatchObject({
        items: [
          {
            thread_id: "thread-pending",
            agent_name: "lead_agent",
            agent_status: "dev",
            values: {
              title: "Draft the launch checklist",
            },
          },
        ],
      });
      expect(
        wrapper.queryClient.getQueryData(
          buildThreadRuntimeQueryKey("thread-pending"),
        ),
      ).toMatchObject({
        thread_id: "thread-pending",
        agent_name: "lead_agent",
        agent_status: "dev",
      });
    });
  });

  it("strips role prefixes from the pending thread title", async () => {
    const wrapper = createWrapper();
    wrapper.queryClient.setQueryData(
      buildThreadSearchQueryKey(DEFAULT_THREAD_SEARCH_PARAMS),
      [],
    );
    streamState.submit.mockImplementation(() => createPendingPromise<void>());

    const { result } = renderHook(
      () =>
        useThreadStream({
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper },
    );

    await act(async () => {
      void result.current[1]("thread-prefixed", {
        text: "User:\n修复标题生成",
        files: [],
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      const cachedThreads = wrapper.queryClient.getQueryData<{
        items: AgentThread[];
      }>(
        buildThreadSearchQueryKey(DEFAULT_THREAD_SEARCH_PARAMS),
      );
      expect(cachedThreads).toMatchObject({
        items: [
          {
            thread_id: "thread-prefixed",
            values: {
              title: "修复标题生成",
            },
          },
        ],
      });
    });
  });

  it("normalizes escaped newlines in the pending thread title", async () => {
    const wrapper = createWrapper();
    wrapper.queryClient.setQueryData(
      buildThreadSearchQueryKey(DEFAULT_THREAD_SEARCH_PARAMS),
      [],
    );
    streamState.submit.mockImplementation(() => createPendingPromise<void>());

    const { result } = renderHook(
      () =>
        useThreadStream({
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper },
    );

    await act(async () => {
      void result.current[1]("thread-escaped-prefix", {
        text: String.raw`User:\n修复标题生成`,
        files: [],
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      const cachedThreads = wrapper.queryClient.getQueryData<{
        items: AgentThread[];
      }>(
        buildThreadSearchQueryKey(DEFAULT_THREAD_SEARCH_PARAMS),
      );
      expect(cachedThreads).toMatchObject({
        items: [
          {
            thread_id: "thread-escaped-prefix",
            values: {
              title: "修复标题生成",
            },
          },
        ],
      });
    });
  });

  it("normalizes double-escaped newlines in the pending thread title", async () => {
    const wrapper = createWrapper();
    wrapper.queryClient.setQueryData(
      buildThreadSearchQueryKey(DEFAULT_THREAD_SEARCH_PARAMS),
      [],
    );
    streamState.submit.mockImplementation(() => createPendingPromise<void>());

    const { result } = renderHook(
      () =>
        useThreadStream({
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper },
    );

    await act(async () => {
      void result.current[1]("thread-double-escaped-prefix", {
        text: String.raw`User:\\n修复标题生成`,
        files: [],
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      const cachedThreads = wrapper.queryClient.getQueryData<{
        items: AgentThread[];
      }>(
        buildThreadSearchQueryKey(DEFAULT_THREAD_SEARCH_PARAMS),
      );
      expect(cachedThreads).toMatchObject({
        items: [
          {
            thread_id: "thread-double-escaped-prefix",
            values: {
              title: "修复标题生成",
            },
          },
        ],
      });
    });
  });

  it("does not invalidate sidebar search while a new run is still in flight", async () => {
    const wrapper = createWrapper();
    const invalidateQueriesSpy = vi.spyOn(
      wrapper.queryClient,
      "invalidateQueries",
    );
    streamState.submit.mockImplementation(() => createPendingPromise<void>());

    const { result } = renderHook(
      () =>
        useThreadStream({
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper },
    );

    await act(async () => {
      void result.current[1]("thread-pending", {
        text: "Keep this draft visible",
        files: [],
      });
      await Promise.resolve();
    });

    expect(invalidateQueriesSpy).not.toHaveBeenCalledWith({
      queryKey: THREAD_SEARCH_QUERY_KEY,
    });
  });

  it("refreshes sidebar search when a run finishes", async () => {
    const wrapper = createWrapper();
    const invalidateQueriesSpy = vi.spyOn(
      wrapper.queryClient,
      "invalidateQueries",
    );

    renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper },
    );

    const onFinish = latestUseStreamOptions?.onFinish;
    expect(typeof onFinish).toBe("function");
    if (typeof onFinish !== "function") {
      throw new Error("Expected onFinish callback to be registered.");
    }

    act(() => {
      onFinish({
        values: {
          title: "Thread",
          messages: [],
          artifacts: [],
        },
      });
    });

    await waitFor(() => {
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({
        queryKey: THREAD_SEARCH_QUERY_KEY,
      });
    });
  });

  it("refetches persisted state after stop and preserves visible messages", async () => {
    const initialMessages: Message[] = [
      {
        id: "human-1",
        type: "human",
        content: [{ type: "text", text: "Draft the plan" }],
        additional_kwargs: {},
      },
      {
        id: "ai-1",
        type: "ai",
        content: [{ type: "text", text: "Working on it" }],
        additional_kwargs: {},
      },
    ];
    const persistedValues: AgentThreadState = {
      title: "Thread",
      messages: initialMessages,
      artifacts: [],
    };

    streamState = makeThreadState({
      messages: initialMessages,
      values: persistedValues,
      stop: vi.fn().mockResolvedValue(undefined),
    });
    window.sessionStorage.setItem("lg:stream:thread-1", "run-stop-1");
    apiClient.threads.getState.mockResolvedValueOnce({
      values: persistedValues,
    });
    apiClient.threads.getHistory.mockResolvedValueOnce([
      {
        values: persistedValues,
      },
    ]);

    const { result } = renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await result.current[0].stop();
    });

    expect(apiClient.runs.cancel).toHaveBeenCalledWith(
      "thread-1",
      "run-stop-1",
    );
    expect(apiClient.threads.getState).toHaveBeenCalledWith(
      "thread-1",
      undefined,
      { subgraphs: true },
    );
    expect(result.current[0].messages).toEqual(initialMessages);
  });

  it("still stops locally when the server-side cancel request fails", async () => {
    const initialMessages: Message[] = [
      {
        id: "human-1",
        type: "human",
        content: [{ type: "text", text: "Stop this run" }],
        additional_kwargs: {},
      },
    ];
    const persistedValues: AgentThreadState = {
      title: "Thread",
      messages: initialMessages,
      artifacts: [],
    };

    const stopMock = vi.fn().mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    streamState = makeThreadState({
      messages: initialMessages,
      values: persistedValues,
      stop: stopMock,
    });
    window.sessionStorage.setItem("lg:stream:thread-1", "run-stop-2");
    apiClient.runs.cancel.mockRejectedValueOnce(new Error("cancel failed"));
    apiClient.threads.getState.mockResolvedValueOnce({
      values: persistedValues,
    });
    apiClient.threads.getHistory.mockResolvedValueOnce([]);

    const { result } = renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await result.current[0].stop();
    });

    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(apiClient.runs.cancel).toHaveBeenCalledWith(
      "thread-1",
      "run-stop-2",
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to cancel active run run-stop-2 for thread thread-1:",
      expect.any(Error),
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it("prefers the created stream thread id over a draft route id when canceling", async () => {
    streamState = makeThreadState({
      stop: vi.fn().mockResolvedValue(undefined),
    });
    apiClient.threads.getState.mockResolvedValueOnce({
      values: {
        title: "Thread",
        messages: [],
        artifacts: [],
      },
    });
    apiClient.threads.getHistory.mockResolvedValueOnce([]);

    const { result } = renderHook(
      () =>
        useThreadStream({
          threadId: "draft-thread",
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    const onCreated = latestUseStreamOptions?.onCreated;
    expect(typeof onCreated).toBe("function");
    if (typeof onCreated !== "function") {
      throw new Error("Expected onCreated callback to be registered.");
    }

    await act(async () => {
      onCreated({
        thread_id: "thread-real",
        run_id: "run-real",
      });
      await Promise.resolve();
    });

    await act(async () => {
      await result.current[0].stop();
    });

    expect(apiClient.runs.cancel).toHaveBeenCalledWith(
      "thread-real",
      "run-real",
    );
  });

  it("still cancels a deferred-history run when branch tree access throws", async () => {
    const persistedValues: AgentThreadState = {
      title: "Thread",
      messages: [
        {
          id: "human-1",
          type: "human",
          content: [{ type: "text", text: "Stop this looping run" }],
          additional_kwargs: {},
        },
      ],
      artifacts: [],
    };
    const stopMock = vi.fn().mockResolvedValue(undefined);
    const throwingThreadState = makeThreadState({
      messages: persistedValues.messages ?? [],
      values: persistedValues,
      stop: stopMock,
    });
    Object.defineProperty(throwingThreadState, "experimental_branchTree", {
      configurable: true,
      enumerable: true,
      get() {
        throw new Error(
          "`fetchStateHistory` must be set to `true` to use `experimental_branchTree`",
        );
      },
    });
    streamState = throwingThreadState;
    window.sessionStorage.setItem("lg:stream:thread-1", "run-stop-3");
    apiClient.threads.getState.mockResolvedValueOnce({
      values: persistedValues,
    });
    apiClient.threads.getHistory.mockResolvedValueOnce([]);

    const { result } = renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          skipInitialHistory: true,
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await result.current[0].stop();
    });

    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(apiClient.runs.cancel).toHaveBeenCalledWith(
      "thread-1",
      "run-stop-3",
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it("reuses the manually fetched history after stopping a deferred-history run", async () => {
    const persistedValues: AgentThreadState = {
      title: "Thread",
      messages: [
        {
          id: "human-1",
          type: "human",
          content: [{ type: "text", text: "Stop and keep the trace" }],
          additional_kwargs: {},
        },
      ],
      artifacts: [],
    };
    const persistedHistory = [
      {
        values: persistedValues,
      },
    ];

    streamState = makeThreadState({
      messages: persistedValues.messages ?? [],
      values: persistedValues,
      stop: vi.fn().mockResolvedValue(undefined),
    });
    window.sessionStorage.setItem("lg:stream:thread-1", "run-stop-4");
    apiClient.threads.getState.mockResolvedValueOnce({
      values: persistedValues,
    });
    apiClient.threads.getHistory.mockResolvedValueOnce(persistedHistory);

    const { result } = renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          skipInitialHistory: true,
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    expect(latestUseStreamOptions?.fetchStateHistory).toBe(false);

    await act(async () => {
      await result.current[0].stop();
    });

    expect(apiClient.threads.getHistory).toHaveBeenCalledTimes(1);
    expect(latestUseStreamOptions?.fetchStateHistory).toBe(false);
  });

  it("keeps the seeded history after stopping even when the live history getter throws", async () => {
    const persistedValues: AgentThreadState = {
      title: "Thread",
      messages: [
        {
          id: "human-1",
          type: "human",
          content: [{ type: "text", text: "Stop and keep the seeded history" }],
          additional_kwargs: {},
        },
      ],
      artifacts: [],
    };
    const persistedHistory = [
      {
        values: persistedValues,
      },
    ];
    const stopMock = vi.fn().mockResolvedValue(undefined);
    const throwingThreadState = makeThreadState({
      messages: persistedValues.messages ?? [],
      values: persistedValues,
      stop: stopMock,
    });
    Object.defineProperty(throwingThreadState, "history", {
      configurable: true,
      enumerable: true,
      get() {
        throw new Error(
          "`fetchStateHistory` must be set to `true` to use `history`",
        );
      },
    });
    streamState = throwingThreadState;
    window.sessionStorage.setItem("lg:stream:thread-1", "run-stop-history");
    apiClient.threads.getState.mockResolvedValueOnce({
      values: persistedValues,
    });
    apiClient.threads.getHistory.mockResolvedValueOnce(persistedHistory);

    const { result } = renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          skipInitialHistory: true,
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await result.current[0].stop();
    });

    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(apiClient.threads.getHistory).toHaveBeenCalledTimes(1);
    expect(result.current[0].messages).toEqual(persistedValues.messages);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("does not touch stream history when initial history loading is disabled", () => {
    const throwingThreadState = makeThreadState();
    Object.defineProperty(throwingThreadState, "history", {
      configurable: true,
      enumerable: true,
      get() {
        throw new Error("history getter should stay unused");
      },
    });
    streamState = throwingThreadState;
    apiClient.threads.create.mockImplementation(() => createPendingPromise());

    const { result } = renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          skipInitialHistory: true,
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    expect(result.current[0].history).toEqual([]);
  });

  it("fetches current thread state while initial history loading is disabled", async () => {
    apiClient.threads.create.mockImplementation(() => createPendingPromise());

    renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          skipInitialHistory: true,
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(apiClient.threads.getState).toHaveBeenCalledWith(
        "thread-1",
        undefined,
        { subgraphs: true },
      );
    });
  });

  it("does not poll deferred-history state while a live stream is still active", async () => {
    apiClient.threads.create.mockImplementation(() => createPendingPromise());
    streamState = makeThreadState({
      isLoading: true,
    });

    renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          skipInitialHistory: true,
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(apiClient.threads.getState).not.toHaveBeenCalled();
  });

  it("defers state hydration for threads created during the current session until the first run finishes", async () => {
    type ThreadStreamProps = {
      threadId?: string;
    };

    const { rerender } = renderHook(
      ({ threadId }: ThreadStreamProps) =>
        useThreadStream({
          threadId,
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      {
        initialProps: { threadId: undefined as string | undefined },
        wrapper: createWrapper(),
      },
    );

    const onCreated = latestUseStreamOptions?.onCreated;
    expect(typeof onCreated).toBe("function");
    if (typeof onCreated !== "function") {
      throw new Error("Expected onCreated callback to be registered.");
    }

    act(() => {
      onCreated({ thread_id: "thread-new" });
    });

    await waitFor(() => {
      expect(latestUseStreamOptions?.threadId).toBe("thread-new");
      expect(latestUseStreamOptions?.thread).toEqual({
        data: [],
        error: undefined,
        isLoading: false,
        mutate: expect.any(Function),
      });
    });

    await act(async () => {
      rerender({ threadId: "thread-new" });
    });

    expect(latestUseStreamOptions?.threadId).toBe("thread-new");
    expect(apiClient.threads.create).not.toHaveBeenCalled();
    expect(apiClient.threads.getState).not.toHaveBeenCalled();

    const onFinish = latestUseStreamOptions?.onFinish;
    expect(typeof onFinish).toBe("function");
    if (typeof onFinish !== "function") {
      throw new Error("Expected onFinish callback to be registered.");
    }

    act(() => {
      onFinish({
        values: {
          title: "Thread",
          messages: [],
          artifacts: [],
        },
      });
    });

    await waitFor(() => {
      expect(apiClient.threads.getState).toHaveBeenCalledWith(
        "thread-new",
        undefined,
        { subgraphs: true },
      );
    });
  });

  it("does not re-fetch thread state on unrelated stream rerenders", async () => {
    apiClient.threads.create.mockImplementation(() => createPendingPromise());

    renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          skipInitialHistory: true,
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(apiClient.threads.getState).toHaveBeenCalledTimes(1);
    });

    act(() => {
      emitStream({
        error: new Error("stream tick"),
      });
    });

    expect(apiClient.threads.getState).toHaveBeenCalledTimes(1);
  });

  it("hydrates current thread messages when history loading is enabled", async () => {
    const persistedMessages: Message[] = [
      {
        id: "human-1",
        type: "human",
        content: [{ type: "text", text: "hello" }],
        additional_kwargs: {},
      },
      {
        id: "ai-1",
        type: "ai",
        content: [{ type: "text", text: "world" }],
        additional_kwargs: {},
      },
    ];
    apiClient.threads.getState.mockResolvedValueOnce({
      values: {
        title: "Thread",
        messages: persistedMessages,
        artifacts: [],
      },
    });

    const { result } = renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(apiClient.threads.getState).toHaveBeenCalledWith(
        "thread-1",
        undefined,
        { subgraphs: true },
      );
      expect(result.current[0].messages).toEqual(persistedMessages);
    });
  });

  it("drops hydration overrides once live stream messages advance past the hydrated state", async () => {
    const hydratedMessages: Message[] = [
      {
        id: "human-1",
        type: "human",
        content: [{ type: "text", text: "hello" }],
        additional_kwargs: {},
      },
    ];
    const streamedMessages: Message[] = [
      ...hydratedMessages,
      {
        id: "ai-1",
        type: "ai",
        content: [{ type: "text", text: "streamed reply" }],
        additional_kwargs: {},
      },
    ];

    apiClient.threads.create.mockImplementation(() => createPendingPromise());
    apiClient.threads.getState.mockResolvedValueOnce({
      values: {
        title: "Thread",
        messages: hydratedMessages,
        artifacts: [],
      },
      next: ["model"],
      metadata: {
        run_id: "run-active-1",
      },
    });
    window.sessionStorage.setItem("openagents:stream-owner:thread-1", "1");

    const { result } = renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          skipInitialHistory: true,
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current[0].messages).toEqual(hydratedMessages);
    });

    act(() => {
      emitStream({
        messages: streamedMessages,
        values: {
          title: "Thread",
          messages: streamedMessages,
          artifacts: [],
        },
        isLoading: true,
      });
    });

    await waitFor(() => {
      expect(result.current[0].messages).toEqual(streamedMessages);
    });
  });

  it("drops hydration overrides when a streamed message chunk updates in place", async () => {
    const hydratedMessages: Message[] = [
      {
        id: "human-1",
        type: "human",
        content: [{ type: "text", text: "hello" }],
        additional_kwargs: {},
      },
      {
        id: "ai-1",
        type: "ai",
        content: [{ type: "text", text: "partial" }],
        additional_kwargs: {},
      },
    ];
    const streamedMessages: Message[] = [
      {
        id: "human-1",
        type: "human",
        content: [{ type: "text", text: "hello" }],
        additional_kwargs: {},
      },
      {
        id: "ai-1",
        type: "ai",
        content: [{ type: "text", text: "partial reply expanded" }],
        additional_kwargs: {},
      },
    ];

    apiClient.threads.create.mockImplementation(() => createPendingPromise());
    apiClient.threads.getState.mockResolvedValueOnce({
      values: {
        title: "Thread",
        messages: hydratedMessages,
        artifacts: [],
      },
      next: ["model"],
      metadata: {
        run_id: "run-active-1",
      },
    });
    window.sessionStorage.setItem("openagents:stream-owner:thread-1", "1");

    const { result } = renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          skipInitialHistory: true,
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current[0].messages).toEqual(hydratedMessages);
    });

    act(() => {
      emitStream({
        messages: streamedMessages,
        values: {
          title: "Thread",
          messages: streamedMessages,
          artifacts: [],
        },
        isLoading: true,
      });
    });

    await waitFor(() => {
      expect(result.current[0].messages).toEqual(streamedMessages);
    });
  });

  it("rejoins an owned active run during initial pending-run hydration with full stream modes", async () => {
    apiClient.threads.create.mockImplementation(() => createPendingPromise());
    apiClient.threads.getState.mockResolvedValueOnce({
      values: {
        title: "Thread",
        messages: [
          {
            id: "human-1",
            type: "human",
            content: [{ type: "text", text: "hello" }],
            additional_kwargs: {},
          },
        ],
        artifacts: [],
      },
      next: ["tools"],
      metadata: {
        run_id: "run-active-1",
      },
    });
    window.sessionStorage.setItem("openagents:stream-owner:thread-1", "1");

    renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          skipInitialHistory: true,
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(apiClient.threads.getState).toHaveBeenCalledWith(
        "thread-1",
        undefined,
        { subgraphs: true },
      );
    });
    expect(streamState.joinStream).toHaveBeenCalledWith(
      "run-active-1",
      undefined,
      {
        streamMode: ["values", "messages-tuple", "custom"],
      },
    );
  });

  it("rejoins immediately from stored run metadata before thread state hydration catches up", async () => {
    apiClient.threads.create.mockImplementation(() => createPendingPromise());
    apiClient.threads.getState.mockResolvedValueOnce({
      values: {
        title: "Thread",
        messages: [],
        artifacts: [],
      },
    });
    window.sessionStorage.setItem("openagents:stream-owner:thread-1", "1");
    window.sessionStorage.setItem("lg:stream:thread-1", "run-resume-1");

    renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          skipInitialHistory: true,
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(streamState.joinStream).toHaveBeenCalledWith(
        "run-resume-1",
        undefined,
        {
          streamMode: ["values", "messages-tuple", "custom"],
        },
      );
    });
  });

  it("waits for useStream to retarget before replaying a stored run after switching threads", async () => {
    apiClient.threads.create.mockImplementation(() => createPendingPromise());
    const joinThreadIds: Array<string | undefined> = [];
    streamState = makeThreadState({
      joinStream: vi.fn().mockImplementation(async () => {
        joinThreadIds.push(latestUseStreamOptions?.threadId as string | undefined);
      }),
    });
    window.sessionStorage.setItem("openagents:stream-owner:thread-2", "1");
    window.sessionStorage.setItem("lg:stream:thread-2", "run-resume-2");

    const { rerender } = renderHook(
      ({ threadId }: { threadId: string }) =>
        useThreadStream({
          threadId,
          skipInitialHistory: true,
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      {
        initialProps: { threadId: "thread-1" },
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      rerender({ threadId: "thread-2" });
    });

    await waitFor(() => {
      expect(streamState.joinStream).toHaveBeenCalledWith(
        "run-resume-2",
        undefined,
        {
          streamMode: ["values", "messages-tuple", "custom"],
        },
      );
    });
    expect(joinThreadIds).toEqual(["thread-2"]);
  });

  it("suppresses stale run-not-found errors and retries with the hydrated active run id", async () => {
    apiClient.threads.create.mockImplementation(() => createPendingPromise());
    streamState = makeThreadState({
      joinStream: vi
        .fn()
        .mockRejectedValueOnce(new Error("Run not found"))
        .mockImplementationOnce(async () => {
          emitStream({ isLoading: true });
        }),
    });
    apiClient.threads.getState.mockResolvedValueOnce({
      values: {
        title: "Thread",
        messages: [
          {
            id: "human-1",
            type: "human",
            content: [{ type: "text", text: "hello" }],
            additional_kwargs: {},
          },
        ],
        artifacts: [],
      },
      next: ["tools"],
      metadata: {
        run_id: "run-active-2",
      },
    });
    window.sessionStorage.setItem("openagents:stream-owner:thread-1", "1");
    window.sessionStorage.setItem("lg:stream:thread-1", "run-stale-1");

    const { result } = renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          skipInitialHistory: true,
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(streamState.joinStream).toHaveBeenNthCalledWith(
        1,
        "run-stale-1",
        undefined,
        {
          streamMode: ["values", "messages-tuple", "custom"],
        },
      );
    });
    await waitFor(() => {
      expect(streamState.joinStream).toHaveBeenNthCalledWith(
        2,
        "run-active-2",
        undefined,
        {
          streamMode: ["values", "messages-tuple", "custom"],
        },
      );
    });

    expect(result.current[0].isLoading).toBe(true);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("suppresses stale run-not-found thread errors while rejoining the hydrated active run", async () => {
    apiClient.threads.create.mockImplementation(() => createPendingPromise());
    streamState = makeThreadState({
      joinStream: vi
        .fn()
        .mockImplementationOnce(async () => {
          emitStream({ error: new Error("Run not found") });
          throw new Error("Run not found");
        })
        .mockImplementationOnce(async () => {
          emitStream({
            error: undefined,
            isLoading: true,
          });
        }),
    });
    apiClient.threads.getState.mockResolvedValueOnce({
      values: {
        title: "Thread",
        messages: [
          {
            id: "human-1",
            type: "human",
            content: [{ type: "text", text: "hello" }],
            additional_kwargs: {},
          },
        ],
        artifacts: [],
      },
      next: ["tools"],
      metadata: {
        run_id: "run-active-3",
      },
    });
    window.sessionStorage.setItem("openagents:stream-owner:thread-1", "1");
    window.sessionStorage.setItem("lg:stream:thread-1", "run-stale-2");

    renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          skipInitialHistory: true,
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(streamState.joinStream).toHaveBeenNthCalledWith(
        1,
        "run-stale-2",
        undefined,
        {
          streamMode: ["values", "messages-tuple", "custom"],
        },
      );
    });
    await waitFor(() => {
      expect(streamState.joinStream).toHaveBeenNthCalledWith(
        2,
        "run-active-3",
        undefined,
        {
          streamMode: ["values", "messages-tuple", "custom"],
        },
      );
    });

    expect(toastError).not.toHaveBeenCalled();
  });

  it("recovers the final assistant state when the live finish event is missed", async () => {
    apiClient.threads.create.mockImplementation(() => createPendingPromise());
    const humanMessage: Message = {
      id: "human-1",
      type: "human",
      content: [{ type: "text", text: "hello" }],
      additional_kwargs: {},
    };
    const aiMessage: Message = {
      id: "ai-1",
      type: "ai",
      content: [{ type: "text", text: "world" }],
      additional_kwargs: {},
    };
    const completedState = {
      title: "Thread",
      messages: [humanMessage, aiMessage],
      artifacts: [],
    };
    streamState = makeThreadState({
      messages: [humanMessage],
      values: {
        title: "Thread",
        messages: [humanMessage],
        artifacts: [],
      },
    });

    apiClient.threads.getState
      .mockResolvedValueOnce({
        values: {
          title: "Thread",
          messages: [humanMessage],
          artifacts: [],
        },
        next: ["tools"],
        metadata: {
          run_id: "run-active-1",
        },
      })
      .mockResolvedValue({
        values: completedState,
        next: [],
        metadata: {
          run_id: "run-active-1",
        },
      });
    window.sessionStorage.setItem("openagents:stream-owner:thread-1", "1");

    const onFinish = vi.fn();
    const { result } = renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          skipInitialHistory: true,
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
          onFinish,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current[0].messages).toEqual([humanMessage, aiMessage]);
    });
    expect(onFinish).toHaveBeenCalledWith(completedState);
    expect(
      window.sessionStorage.getItem("openagents:stream-owner:thread-1"),
    ).toBeNull();
  });

  it("treats persisted task errors as terminal recovery state even when next is stale", async () => {
    apiClient.threads.create.mockImplementation(() => createPendingPromise());
    const humanMessage: Message = {
      id: "human-1",
      type: "human",
      content: [{ type: "text", text: "hello" }],
      additional_kwargs: {},
    };
    apiClient.threads.getState.mockResolvedValueOnce({
      values: {
        title: "Thread",
        messages: [humanMessage],
        artifacts: [],
      },
      next: ["model"],
      tasks: [
        {
          id: "task-1",
          error: 'InternalServerError("503 upstream")',
        },
      ],
      metadata: {
        run_id: "run-active-1",
      },
    });
    window.sessionStorage.setItem("openagents:stream-owner:thread-1", "1");

    const onStop = vi.fn();
    const { result } = renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          skipInitialHistory: true,
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
          onStop,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(onStop).toHaveBeenCalledWith({
        title: "Thread",
        messages: [humanMessage],
        artifacts: [],
      });
    });
    expect(result.current[0].isLoading).toBe(false);
    expect(toastError).toHaveBeenCalledWith("503 upstream", {
      id: "thread-error:thread-1:503 upstream",
    });
    expect(
      window.sessionStorage.getItem("openagents:stream-owner:thread-1"),
    ).toBeNull();
  });

  it("does not join an active run from another tab without local ownership", async () => {
    apiClient.threads.create.mockImplementation(() => createPendingPromise());
    apiClient.threads.getState.mockResolvedValueOnce({
      values: {
        title: "Thread",
        messages: [
          {
            id: "human-1",
            type: "human",
            content: [{ type: "text", text: "hello" }],
            additional_kwargs: {},
          },
        ],
        artifacts: [],
      },
      next: ["tools"],
      metadata: {
        run_id: "run-active-1",
      },
    });

    renderHook(
      () =>
        useThreadStream({
          threadId: "thread-1",
          skipInitialHistory: true,
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(apiClient.threads.getState).toHaveBeenCalledWith(
        "thread-1",
        undefined,
        { subgraphs: true },
      );
    });
    expect(streamState.joinStream).not.toHaveBeenCalled();
  });

  it("connects to an existing thread immediately while create runs in the background", () => {
    apiClient.threads.create.mockImplementation(() => createPendingPromise());

    renderHook(
      () =>
        useThreadStream({
          threadId: "thread-existing",
          skipInitialHistory: true,
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    expect(latestUseStreamOptions?.threadId).toBe("thread-existing");
    expect(apiClient.threads.create).toHaveBeenCalledWith({
      threadId: "thread-existing",
      ifExists: "do_nothing",
      graphId: "lead_agent",
    });
  });

  it("waits for thread creation before submitting the first run on a preallocated thread", async () => {
    let resolveCreate: (() => void) | undefined;
    apiClient.threads.create.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCreate = resolve;
        }),
    );

    const { result } = renderHook(
      () =>
        useThreadStream({
          threadId: "thread-new",
          skipInitialHistory: true,
          context: {
            model_name: "kimi-k2.5",
            mode: "pro",
            agent_status: "dev",
          },
        }),
      { wrapper: createWrapper() },
    );

    const message: PromptInputMessage = {
      text: "hello",
      files: [],
    };

    let submitPromise: Promise<void> | undefined;
    await act(async () => {
      submitPromise = result.current[1]("thread-new", message);
      await Promise.resolve();
    });

    expect(streamState.submit).not.toHaveBeenCalled();

    act(() => {
      resolveCreate?.();
    });

    await act(async () => {
      await submitPromise;
    });

    expect(streamState.submit).toHaveBeenCalledTimes(1);
  });
});
