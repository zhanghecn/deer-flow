import type { Message } from "@langchain/langgraph-sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";

import { useThreadStream } from "./hooks";
import {
  buildThreadRuntimeQueryKey,
  buildThreadSearchQueryKey,
  DEFAULT_THREAD_SEARCH_PARAMS,
} from "./search";
import type { AgentThread, AgentThreadState } from "./types";

type MockThreadState = {
  values: AgentThreadState;
  messages: Message[];
  history: Array<{ values: AgentThreadState }>;
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
const apiClient = {
  threads: {
    create: vi.fn(),
    getState: vi.fn(),
    getHistory: vi.fn(),
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
  getAPIClient: () => apiClient,
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
    context: {
      model_name: "kimi-k2.5",
      mode: "pro",
      reasoning_effort: "high",
      agent_status: "dev",
    },
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
    streamState = makeThreadState();
  });

  it("surfaces stream errors through a toast once per distinct message", async () => {
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
      expect(toastError).toHaveBeenCalledWith("Connection error");
    });

    act(() => {
      emitStream({
        error: new Error("Connection error"),
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

    expect(toastError).toHaveBeenCalledWith("429 Too Many Requests");
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
      const cachedThreads = wrapper.queryClient.getQueryData<AgentThread[]>(
        buildThreadSearchQueryKey(DEFAULT_THREAD_SEARCH_PARAMS),
      );
      expect(cachedThreads).toMatchObject([
        {
          thread_id: "thread-pending",
          agent_name: "lead_agent",
          agent_status: "dev",
          values: {
            title: "Draft the launch checklist",
          },
        },
      ]);
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

    expect(apiClient.threads.getState).toHaveBeenCalledWith(
      "thread-1",
      undefined,
      { subgraphs: true },
    );
    expect(result.current[0].messages).toEqual(initialMessages);
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

  it("joins an active run from current thread state while initial history loading is disabled", async () => {
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
      expect(streamState.joinStream).toHaveBeenCalledWith("run-active-1");
    });
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
