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
});
