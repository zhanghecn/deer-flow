import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { AgentThread } from "@/core/threads/types";

import { RecentChatList } from "./recent-chat-list";

const { deleteThreadMock, renameThreadMock } = vi.hoisted(() => ({
  deleteThreadMock: vi.fn(),
  renameThreadMock: vi.fn(),
}));

vi.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    t: {
      sidebar: {
        recentChats: "Recent chats",
        demoChats: "Demo chats",
      },
      common: {
        more: "More",
        rename: "Rename",
        share: "Share",
        delete: "Delete",
        cancel: "Cancel",
        save: "Save",
      },
      clipboard: {
        linkCopied: "Link copied",
        failedToCopyToClipboard: "Failed to copy",
      },
    },
  }),
}));

function buildThread(threadId: string, title: string): AgentThread {
  // Tests only need the list contract consumed by RecentChatList; the full
  // LangGraph Thread shape is supplied by the backend in browser flows.
  return {
    thread_id: threadId,
    agent_name: "lead_agent",
    agent_status: "dev",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    metadata: {},
    status: "idle",
    interrupts: {},
    values: {
      title,
      messages: [],
      artifacts: [],
    },
  } as unknown as AgentThread;
}

const threads: AgentThread[] = [
  buildThread("thread-active", "Active chat"),
  buildThread("thread-other", "Other chat"),
];

vi.mock("@/core/threads/query-hooks", () => ({
  useThreads: () => ({
    data: {
      items: threads,
      total: threads.length,
    },
  }),
  useDeleteThread: () => ({
    mutateAsync: deleteThreadMock,
  }),
  useRenameThread: () => ({
    mutate: renameThreadMock,
  }),
}));

describe("RecentChatList", () => {
  it("renders recent chat navigation without sidebar Slot wrappers", () => {
    render(
      <MemoryRouter
        initialEntries={["/workspace/chats/thread-active?agent_status=dev"]}
      >
        <Routes>
          <Route
            path="/workspace/chats/:thread_id"
            element={<RecentChatList />}
          />
        </Routes>
      </MemoryRouter>,
    );

    const activeLink = screen.getByRole("link", { name: "Active chat" });
    expect(activeLink.tagName).toBe("A");
    expect(activeLink).toHaveAttribute("data-sidebar", "menu-button");
    expect(activeLink).toHaveAttribute("data-active", "true");

    const menuButtons = screen.getAllByRole("button", { name: "More" });
    expect(menuButtons).toHaveLength(2);
    expect(menuButtons[0]).toHaveAttribute("data-sidebar", "menu-action");
  });
});
