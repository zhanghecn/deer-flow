import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import NewChatClient from "./new-chat-client";

const inputBoxMock = vi.fn();

vi.mock("@/components/ai-elements/prompt-input", () => ({
  PromptInputProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/workspace/agent-switcher-dialog", () => ({
  AgentSwitcherDialog: () => null,
}));

vi.mock("@/components/workspace/chats/use-thread-chat", () => ({
  useThreadChat: () => ({
    threadId: "draft-thread-route",
    setThreadId: vi.fn(),
    isNewThread: true,
    setIsNewThread: vi.fn(),
    isMock: false,
  }),
}));

vi.mock("@/components/workspace/input-box", () => ({
  InputBox: (props: unknown) => {
    inputBoxMock(props);
    return <div data-testid="input-box" />;
  },
}));

vi.mock("@/components/workspace/welcome", () => ({
  Welcome: () => null,
}));

vi.mock("@/core/agents", () => ({
  buildWorkspaceAgentPath: (_selection: unknown, threadId: string) =>
    `/workspace/agents/demo-agent/chats/${threadId}`,
  isLeadAgent: (agentName: string) => agentName === "lead_agent",
  readAgentRuntimeSelection: () => ({
    agentName: "demo-agent",
    agentStatus: "dev",
    executionBackend: undefined,
    remoteSessionId: "",
  }),
  useAgent: () => ({
    agent: null,
  }),
}));

vi.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    t: {
      common: {
        notAvailableInDemoMode: "Not available",
      },
    },
  }),
}));

vi.mock("@/core/models/hooks", () => ({
  useModels: () => ({
    models: [
      {
        name: "kimi-k2.5",
        display_name: "Kimi K2.5",
      },
    ],
  }),
}));

vi.mock("@/core/models", () => ({
  findAvailableModelName: () => "kimi-k2.5",
}));

vi.mock("@/core/settings", () => ({
  useLocalSettings: () => [
    {
      context: {
        model_name: "kimi-k2.5",
        mode: "pro",
      },
    },
    vi.fn(),
  ],
}));

vi.mock("@/env", () => ({
  env: {
    VITE_STATIC_WEBSITE_ONLY: "false",
  },
}));

describe("NewChatClient", () => {
  it("passes the route draft thread id into the new-thread input box", () => {
    render(
      <MemoryRouter initialEntries={["/workspace/agents/demo-agent/chats/new"]}>
        <Routes>
          <Route
            path="/workspace/agents/:agent_name/chats/new"
            element={<NewChatClient />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("input-box")).toBeInTheDocument();
    const firstCall = inputBoxMock.mock.calls[0]?.[0];
    expect(firstCall).toEqual(
      expect.objectContaining({
        ensureThreadExists: expect.any(Function),
        threadId: "draft-thread-route",
        isNewThread: true,
      }),
    );
  });
});
