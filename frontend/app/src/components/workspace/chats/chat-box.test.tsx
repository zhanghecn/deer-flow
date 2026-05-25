import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import {
  ArtifactsProvider,
  useArtifacts,
} from "@/components/workspace/artifacts";
import type * as WorkspaceArtifacts from "@/components/workspace/artifacts";
import { ThreadContext } from "@/components/workspace/messages/context";
import { I18nProvider } from "@/core/i18n/context";
import type { AgentThreadState } from "@/core/threads";
import { WorkspaceSurfaceProvider } from "@/core/workspace-surface/context";

import { ChatBox } from "./chat-box";

type ThreadOutputArtifactsHookArgs = {
  refreshKey?: string;
  refetchIntervalMs?: number | false;
};

type ThreadOutputArtifactsHookResult = {
  artifacts: string[];
  isLoading: boolean;
  error: null;
  lastUpdatedAt: number;
};

type LatestInvocationHookResult = {
  data: {
    response_id: string;
    trace_id?: string;
    status: string;
    error?: string;
  } | null;
  isLoading: boolean;
  error: null;
};

function defaultThreadOutputArtifactsResult(
  _args?: ThreadOutputArtifactsHookArgs,
): ThreadOutputArtifactsHookResult {
  return {
    artifacts: [],
    isLoading: false,
    error: null,
    lastUpdatedAt: 0,
  };
}

const useThreadOutputArtifactsMock = vi.fn<
  (args?: ThreadOutputArtifactsHookArgs) => ThreadOutputArtifactsHookResult
>(defaultThreadOutputArtifactsResult);
const useLatestThreadPublicAPIInvocationMock = vi.fn<
  (args: { threadId: string; enabled?: boolean }) => LatestInvocationHookResult
>(() => ({ data: null, isLoading: false, error: null }));
const artifactDetailRenderPaths = vi.hoisted((): string[] => []);

vi.mock("@/core/artifacts/hooks", () => ({
  useThreadOutputArtifacts: (args?: ThreadOutputArtifactsHookArgs) =>
    useThreadOutputArtifactsMock(args),
}));

vi.mock("@/core/public-api/hooks", () => ({
  useLatestThreadPublicAPIInvocation: (args: {
    threadId: string;
    enabled?: boolean;
  }) => useLatestThreadPublicAPIInvocationMock(args),
}));

vi.mock("@/components/workspace/artifacts", async () => {
  const actual: typeof WorkspaceArtifacts = await vi.importActual(
    "@/components/workspace/artifacts",
  );

  return {
    ...actual,
    ArtifactFileDetail: ({ filepath }: { filepath: string }) => {
      artifactDetailRenderPaths.push(filepath);
      return <div data-testid="artifact-detail">{filepath.split("/").pop()}</div>;
    },
    ArtifactFileList: ({ files }: { files: string[] }) => (
      <div data-testid="artifact-list">
        {files.map((file) => file.split("/").pop()).join(",")}
      </div>
    ),
  };
});

function OpenOfficeArtifact({ path }: { path: string }) {
  const { select, setOpen } = useArtifacts();
  const selectRef = useRef(select);
  const setOpenRef = useRef(setOpen);

  useEffect(() => {
    selectRef.current = select;
    setOpenRef.current = setOpen;
  }, [select, setOpen]);

  useEffect(() => {
    selectRef.current(path);
    setOpenRef.current(true);
  }, [path]);

  return null;
}

function RevealArtifact({ path }: { path: string }) {
  const { reveal } = useArtifacts();

  useEffect(() => {
    reveal({ filepath: path, page: 12 });
  }, [path, reveal]);

  return null;
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function renderChatBoxShell({
  queryClient,
  thread,
  isMock,
  threadId,
  children,
}: {
  queryClient: QueryClient;
  thread: { values: AgentThreadState };
  isMock: boolean;
  threadId: string;
  children?: ReactNode;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider initialLocale="en-US">
        <SidebarProvider>
          <WorkspaceSurfaceProvider>
            <ThreadContext.Provider value={{ thread: thread as never, isMock }}>
              <ArtifactsProvider>
                <ChatBox threadId={threadId}>
                  {children ?? <div>Chat content</div>}
                </ChatBox>
              </ArtifactsProvider>
            </ThreadContext.Provider>
          </WorkspaceSurfaceProvider>
        </SidebarProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

describe("ChatBox", () => {
  beforeEach(() => {
    localStorage.clear();
    artifactDetailRenderPaths.length = 0;
    useThreadOutputArtifactsMock.mockReset();
    useThreadOutputArtifactsMock.mockImplementation(
      defaultThreadOutputArtifactsResult,
    );
    useLatestThreadPublicAPIInvocationMock.mockReset();
    useLatestThreadPublicAPIInvocationMock.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches: false,
        media: "",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
  });

  it("hides virtual runtime paths in the office dialog title", async () => {
    const artifactPath = "/mnt/user-data/outputs/deck.pptx";
    const thread = {
      messages: [],
      isLoading: false,
      values: {
        artifacts: [artifactPath],
        messages: [],
      },
    } as unknown as { values: AgentThreadState };
    const queryClient = createQueryClient();

    render(
      renderChatBoxShell({
        queryClient,
        thread,
        isMock: true,
        threadId: "thread-1",
        children: (
          <>
            <OpenOfficeArtifact path={artifactPath} />
            <div>Chat content</div>
          </>
        ),
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(document.body.textContent).toContain("deck.pptx");
    expect(document.body.textContent).not.toContain(
      "/mnt/user-data/outputs/deck.pptx",
    );
  });

  it("resets the preview panel when switching threads", async () => {
    const artifactPath = "/mnt/user-data/outputs/knowledge-preview.pdf";
    const queryClient = createQueryClient();

    const firstThread = {
      messages: [],
      isLoading: false,
      values: {
        artifacts: [],
        messages: [],
      },
    } as unknown as { values: AgentThreadState };
    const secondThread = {
      messages: [],
      isLoading: false,
      values: {
        artifacts: [],
        messages: [],
      },
    } as unknown as { values: AgentThreadState };

    const { rerender } = render(
      renderChatBoxShell({
        queryClient,
        thread: firstThread,
        isMock: true,
        threadId: "thread-1",
        children: (
          <>
            <RevealArtifact path={artifactPath} />
            <div>Chat content</div>
          </>
        ),
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("artifact-detail")).toHaveTextContent(
        "knowledge-preview.pdf",
      );
    });

    rerender(
      renderChatBoxShell({
        queryClient,
        thread: secondThread,
        isMock: true,
        threadId: "thread-2",
      }),
    );

    await waitFor(() => {
      expect(screen.queryByTestId("artifact-detail")).not.toBeInTheDocument();
    });
  });

  it("does not render a previous thread artifact while switching threads", async () => {
    const previousArtifactPath =
      "/mnt/user-data/outputs/designed-report-v11/index.html";
    const currentArtifactPath =
      "/mnt/user-data/outputs/designed-report-v10/index.html";
    const queryClient = createQueryClient();

    const firstThread = {
      messages: [],
      isLoading: false,
      values: {
        artifacts: [previousArtifactPath],
        messages: [],
      },
    } as unknown as { values: AgentThreadState };
    const secondThread = {
      messages: [],
      isLoading: false,
      values: {
        artifacts: [currentArtifactPath],
        messages: [],
      },
    } as unknown as { values: AgentThreadState };

    const { rerender } = render(
      renderChatBoxShell({
        queryClient,
        thread: firstThread,
        isMock: true,
        threadId: "thread-previous",
        children: (
          <>
            <OpenOfficeArtifact path={previousArtifactPath} />
            <div>Chat content</div>
          </>
        ),
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("artifact-detail")).toHaveTextContent(
        "index.html",
      );
    });

    artifactDetailRenderPaths.length = 0;
    rerender(
      renderChatBoxShell({
        queryClient,
        thread: secondThread,
        isMock: true,
        threadId: "thread-current",
      }),
    );

    expect(artifactDetailRenderPaths).not.toContain(previousArtifactPath);
  });

  it("surfaces failed public API invocations on the thread page", async () => {
    useLatestThreadPublicAPIInvocationMock.mockReturnValue({
      data: {
        response_id: "resp_failed",
        trace_id: "trace_failed",
        status: "failed",
        error: "assistant response text was not found in thread state",
      },
      isLoading: false,
      error: null,
    });
    const thread = {
      messages: [],
      isLoading: false,
      values: {
        artifacts: [],
        messages: [],
      },
    } as unknown as { values: AgentThreadState };
    const queryClient = createQueryClient();

    render(
      renderChatBoxShell({
        queryClient,
        thread,
        isMock: false,
        threadId: "thread-failed",
      }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Run did not complete");
    expect(alert).toHaveTextContent(
      "assistant response text was not found in thread state",
    );
    expect(alert).toHaveTextContent("Response ID: resp_failed");
    expect(alert).toHaveTextContent("Trace ID: trace_failed");
  });

  it("surfaces canceled public API invocations on the thread page", async () => {
    useLatestThreadPublicAPIInvocationMock.mockReturnValue({
      data: {
        response_id: "resp_canceled",
        status: "canceled",
        error: "turn canceled",
      },
      isLoading: false,
      error: null,
    });
    const thread = {
      messages: [],
      isLoading: false,
      values: {
        artifacts: [],
        messages: [],
      },
    } as unknown as { values: AgentThreadState };
    const queryClient = createQueryClient();

    render(
      renderChatBoxShell({
        queryClient,
        thread,
        isMock: false,
        threadId: "thread-canceled",
      }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Run did not complete");
    expect(alert).toHaveTextContent("turn canceled");
    expect(alert).toHaveTextContent("Response ID: resp_canceled");
  });

  it("restores a remembered preview selection after thread hydration", async () => {
    const artifactPath = "/mnt/user-data/outputs/spring-whisper/index.html";
    localStorage.setItem(
      "openagents.workspace-thread-hints",
      JSON.stringify({
        "thread-1": {
          surface: "preview",
          artifact_path: artifactPath,
          updated_at: "2026-05-10T12:52:01.612Z",
        },
      }),
    );
    localStorage.setItem(
      "openagents.local-settings",
      JSON.stringify({
        layout: {
          workspace_dock_open: true,
          workspace_dock_active_surface: "preview",
        },
      }),
    );

    const thread = {
      messages: [],
      isLoading: false,
      values: {
        artifacts: [artifactPath],
        messages: [],
      },
    } as unknown as { values: AgentThreadState };
    const queryClient = createQueryClient();

    render(
      renderChatBoxShell({
        queryClient,
        thread,
        isMock: true,
        threadId: "thread-1",
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("artifact-detail")).toHaveTextContent(
        "index.html",
      );
    });
    expect(
      screen.queryByRole("heading", { name: "No preview selected" }),
    ).not.toBeInTheDocument();
  });

  it("keeps artifact refresh keys stable when a thread flips into loading", () => {
    const artifactPath = "/mnt/user-data/outputs/report.pdf";
    const queryClient = createQueryClient();
    const idleThread = {
      messages: [],
      isLoading: false,
      values: {
        artifacts: [artifactPath],
        messages: [],
      },
    } as unknown as { values: AgentThreadState };
    const loadingThread = {
      messages: [],
      isLoading: true,
      values: {
        artifacts: [artifactPath],
        messages: [],
      },
    } as unknown as { values: AgentThreadState };

    const { rerender } = render(
      renderChatBoxShell({
        queryClient,
        thread: idleThread,
        isMock: false,
        threadId: "thread-1",
      }),
    );

    const initialCalls = useThreadOutputArtifactsMock.mock.calls as Array<
      [{ refreshKey?: string; refetchIntervalMs?: number | false } | undefined]
    >;
    const initialRefreshKey = initialCalls.at(-1)?.[0]?.refreshKey;
    expect(initialRefreshKey).toBe(artifactPath);

    useThreadOutputArtifactsMock.mockClear();

    rerender(
      renderChatBoxShell({
        queryClient,
        thread: loadingThread,
        isMock: false,
        threadId: "thread-1",
      }),
    );

    expect(useThreadOutputArtifactsMock).toHaveBeenCalled();
    const rerenderCalls = useThreadOutputArtifactsMock.mock.calls as Array<
      [{ refreshKey?: string; refetchIntervalMs?: number | false } | undefined]
    >;
    for (const [args] of rerenderCalls) {
      expect(args?.refreshKey).toBe(initialRefreshKey);
    }
    expect(rerenderCalls.at(-1)?.[0]?.refetchIntervalMs).toBe(5000);
  });

  it("backs off artifact polling after repeated identical discovery scans", async () => {
    let lastUpdatedAt = 1;
    let discoveredArtifacts: string[] = [];
    useThreadOutputArtifactsMock.mockImplementation(
      (_args?: {
        refreshKey?: string;
        refetchIntervalMs?: number | false;
      }) => ({
        artifacts: discoveredArtifacts,
        isLoading: false,
        error: null,
        lastUpdatedAt,
      }),
    );

    const queryClient = createQueryClient();
    const loadingThread = {
      messages: [{}],
      isLoading: true,
      values: {
        artifacts: [],
        messages: [],
      },
    } as unknown as { values: AgentThreadState };

    const { rerender } = render(
      renderChatBoxShell({
        queryClient,
        thread: loadingThread,
        isMock: false,
        threadId: "thread-1",
      }),
    );

    const rerenderLoadingThread = (nextUpdatedAt: number) => {
      lastUpdatedAt = nextUpdatedAt;
      rerender(
        renderChatBoxShell({
          queryClient,
          thread: loadingThread,
          isMock: false,
          threadId: "thread-1",
        }),
      );
    };

    const latestArgs = () =>
      (useThreadOutputArtifactsMock.mock.calls.at(-1)?.[0] as
        | { refetchIntervalMs?: number | false }
        | undefined) ?? {};

    await waitFor(() => {
      expect(latestArgs().refetchIntervalMs).toBe(5000);
    });

    rerenderLoadingThread(2);

    await waitFor(() => {
      expect(latestArgs().refetchIntervalMs).toBe(5000);
    });

    rerenderLoadingThread(3);

    await waitFor(() => {
      expect(latestArgs().refetchIntervalMs).toBe(15000);
    });

    rerenderLoadingThread(4);
    rerenderLoadingThread(5);
    rerenderLoadingThread(6);

    await waitFor(() => {
      expect(latestArgs().refetchIntervalMs).toBe(30000);
    });

    discoveredArtifacts = ["/mnt/user-data/outputs/report.pdf"];
    rerenderLoadingThread(7);

    await waitFor(() => {
      expect(latestArgs().refetchIntervalMs).toBe(5000);
    });
  });
});
