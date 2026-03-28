import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import {
  ArtifactsProvider,
  useArtifacts,
} from "@/components/workspace/artifacts";
import type * as WorkspaceArtifacts from "@/components/workspace/artifacts";
import { I18nProvider } from "@/core/i18n/context";
import { ThreadContext } from "@/components/workspace/messages/context";
import type { AgentThreadState } from "@/core/threads";

import { ChatBox } from "./chat-box";

vi.mock("@/components/workspace/artifacts", async () => {
  const actual: typeof WorkspaceArtifacts = await vi.importActual(
    "@/components/workspace/artifacts",
  );

  return {
    ...actual,
    ArtifactFileDetail: ({ filepath }: { filepath: string }) => (
      <div data-testid="artifact-detail">{filepath.split("/").pop()}</div>
    ),
    ArtifactFileList: ({ files }: { files: string[] }) => (
      <div data-testid="artifact-list">
        {files.map((file) => file.split("/").pop()).join(",")}
      </div>
    ),
  };
});

function OpenOfficeArtifact({ path }: { path: string }) {
  const { select, setOpen } = useArtifacts();

  useEffect(() => {
    select(path);
    setOpen(true);
    // Test helper: initialize the artifact selection once.
    // The provider recreates `setOpen` on rerender, so including it here
    // causes an artificial update loop that does not happen in user flows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

describe("ChatBox", () => {
  it("hides virtual runtime paths in the office dialog title", async () => {
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

    const artifactPath = "/mnt/user-data/outputs/deck.pptx";
    const thread = {
      values: {
        artifacts: [artifactPath],
      },
    } as unknown as { values: AgentThreadState };
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider initialLocale="en-US">
          <SidebarProvider>
            <ThreadContext.Provider
              value={{ thread: thread as never, isMock: true }}
            >
              <ArtifactsProvider>
                <OpenOfficeArtifact path={artifactPath} />
                <ChatBox threadId="thread-1">
                  <div>Chat content</div>
                </ChatBox>
              </ArtifactsProvider>
            </ThreadContext.Provider>
          </SidebarProvider>
        </I18nProvider>
      </QueryClientProvider>,
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

    const artifactPath = "/mnt/user-data/outputs/knowledge-preview.pdf";
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    const firstThread = {
      values: {
        artifacts: [],
      },
    } as unknown as { values: AgentThreadState };
    const secondThread = {
      values: {
        artifacts: [],
      },
    } as unknown as { values: AgentThreadState };

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider initialLocale="en-US">
          <SidebarProvider>
            <ThreadContext.Provider
              value={{ thread: firstThread as never, isMock: true }}
            >
              <ArtifactsProvider>
                <RevealArtifact path={artifactPath} />
                <ChatBox threadId="thread-1">
                  <div>Chat content</div>
                </ChatBox>
              </ArtifactsProvider>
            </ThreadContext.Provider>
          </SidebarProvider>
        </I18nProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("artifact-detail")).toHaveTextContent(
        "knowledge-preview.pdf",
      );
    });

    rerender(
      <QueryClientProvider client={queryClient}>
        <I18nProvider initialLocale="en-US">
          <SidebarProvider>
            <ThreadContext.Provider
              value={{ thread: secondThread as never, isMock: true }}
            >
              <ArtifactsProvider>
                <ChatBox threadId="thread-2">
                  <div>Chat content</div>
                </ChatBox>
              </ArtifactsProvider>
            </ThreadContext.Provider>
          </SidebarProvider>
        </I18nProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("artifact-detail")).not.toBeInTheDocument();
    });
  });
});
