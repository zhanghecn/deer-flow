import type { BaseStream } from "@langchain/langgraph-sdk";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentThreadState } from "@/core/threads";

import { ThreadTitle } from "./thread-title";

const { renameThreadMock } = vi.hoisted(() => ({
  renameThreadMock: vi.fn(),
}));

vi.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    t: {
      pages: {
        newChat: "New chat",
        untitled: "Untitled",
        appName: "OpenAgents",
      },
    },
  }),
}));

vi.mock("@/core/threads/query-hooks", () => ({
  useRenameThread: () => ({
    mutate: renameThreadMock,
    isPending: false,
  }),
}));

vi.mock("./chats", () => ({
  useThreadChat: () => ({
    isNewThread: false,
  }),
}));

vi.mock("./flip-display", () => ({
  FlipDisplay: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function buildThread(
  values: Partial<AgentThreadState>,
  overrides: Partial<BaseStream<AgentThreadState>> = {},
) {
  return {
    values,
    isLoading: false,
    isThreadLoading: false,
    ...overrides,
  } as BaseStream<AgentThreadState>;
}

describe("ThreadTitle", () => {
  beforeEach(() => {
    renameThreadMock.mockReset();
    document.title = "OpenAgents";
  });

  it("shows and backfills a deterministic title for older untitled threads", async () => {
    render(
      <ThreadTitle
        threadId="thread-1"
        thread={buildThread({
          messages: [
            {
              type: "human",
              content: [{ type: "text", text: "User:\n生成一份审计 PPT" }],
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("生成一份审计 PPT")).toBeInTheDocument();
    expect(document.title).toBe("生成一份审计 PPT - OpenAgents");
    await waitFor(() =>
      expect(renameThreadMock).toHaveBeenCalledWith(
        { threadId: "thread-1", title: "生成一份审计 PPT" },
        expect.any(Object),
      ),
    );
  });

  it("prefers the persisted title and does not backfill", () => {
    render(
      <ThreadTitle
        threadId="thread-1"
        thread={buildThread({
          title: "Saved title",
          messages: [{ type: "human", content: "Ignored fallback" }],
        })}
      />,
    );

    expect(screen.getByText("Saved title")).toBeInTheDocument();
    expect(renameThreadMock).not.toHaveBeenCalled();
  });

  it("waits for active streams to finish before backfilling a fallback title", () => {
    render(
      <ThreadTitle
        threadId="thread-1"
        thread={buildThread(
          {
            messages: [
              {
                type: "human",
                content: [{ type: "text", text: "生成一份运行报告" }],
              },
            ],
          },
          { isLoading: true },
        )}
      />,
    );

    expect(screen.getByText("生成一份运行报告")).toBeInTheDocument();
    expect(renameThreadMock).not.toHaveBeenCalled();
  });
});
