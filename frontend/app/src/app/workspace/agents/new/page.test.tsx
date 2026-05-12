import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import NewAgentPage from "./page";

const checkAgentNameMock = vi.fn();
const getAgentMock = vi.fn();
const sendMessageMock = vi.fn();
const resumeInterruptMock = vi.fn();
const useThreadStreamMock = vi.fn();
const setSettingsMock = vi.fn();

vi.mock("@/components/ai-elements/prompt-input", () => ({
  PromptInput: ({ children }: { children: ReactNode }) => <form>{children}</form>,
  PromptInputFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PromptInputSubmit: (props: ComponentProps<"button">) => (
    <button type="submit" {...props}>
      Send
    </button>
  ),
  PromptInputTextarea: (props: ComponentProps<"textarea">) => (
    <textarea {...props} />
  ),
}));

vi.mock("@/components/workspace/artifacts/context", () => ({
  ArtifactsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/workspace/messages/message-list", () => ({
  MessageList: () => <div data-testid="message-list" />,
}));

vi.mock("@/components/workspace/messages/question-dock", () => ({
  QuestionDock: () => null,
}));

vi.mock("@/core/agents/api", () => ({
  checkAgentName: (...args: unknown[]) => checkAgentNameMock(...args),
  getAgent: (...args: unknown[]) => getAgentMock(...args),
}));

vi.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    t: {
      agents: {
        createPageTitle: "Create agent",
        createPageSubtitle: "Continue requirements",
        nameStepTitle: "Name the agent",
        nameStepHint: "Choose a stable name.",
        nameStepPlaceholder: "Agent name",
        nameStepContinue: "Continue",
        nameStepInvalidError: "Invalid name",
        nameStepAlreadyExistsError: "Already exists",
        nameStepCheckError: "Check failed",
        agentCreated: "Agent created",
        startChatting: "Start chatting",
        backToGallery: "Back",
      },
    },
  }),
}));

vi.mock("@/core/models/hooks", () => ({
  useModels: () => ({
    models: [{ name: "kimi-k2.5" }],
  }),
}));

vi.mock("@/core/settings", () => ({
  useLocalSettings: () => [
    {
      context: {
        model_name: "kimi-k2.5",
        mode: "pro",
        agent_status: "dev",
      },
    },
    setSettingsMock,
  ],
}));

vi.mock("@/core/threads/hooks", () => ({
  useThreadStream: (...args: unknown[]) => useThreadStreamMock(...args),
}));

vi.mock("@/core/utils/uuid", () => ({
  uuid: () => "thread-new-agent",
}));

describe("NewAgentPage", () => {
  beforeEach(() => {
    checkAgentNameMock.mockReset().mockResolvedValue({ available: true });
    getAgentMock.mockReset().mockRejectedValue(new Error("not flushed"));
    sendMessageMock.mockReset().mockResolvedValue(undefined);
    resumeInterruptMock.mockReset().mockResolvedValue(undefined);
    setSettingsMock.mockReset();
    useThreadStreamMock.mockReset().mockReturnValue([
      {
        isLoading: false,
        messages: [],
        values: { title: "Thread", messages: [], artifacts: [] },
        history: [],
        error: undefined,
        interrupt: undefined,
      },
      sendMessageMock,
      resumeInterruptMock,
      undefined,
      null,
    ]);
    window.sessionStorage.clear();
  });

  it("binds the create-agent stream to its preallocated thread before submitting", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/workspace/agents/new"]}>
        <NewAgentPage />
      </MemoryRouter>,
    );

    expect(useThreadStreamMock).not.toHaveBeenCalled();

    await user.type(screen.getByPlaceholderText("Agent name"), "bms-kb-agent");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(useThreadStreamMock).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: "thread-new-agent",
          skipInitialHistory: true,
          context: expect.objectContaining({
            model_name: "kimi-k2.5",
            agent_status: "dev",
          }),
        }),
      );
    });

    const initialText =
      "/create-agent 请帮我创建一个名为 bms-kb-agent 的智能体，并先从需求澄清开始。";
    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith(
        "thread-new-agent",
        {
          text: initialText,
          files: [],
        },
        expect.objectContaining({
          target_agent_name: "bms-kb-agent",
          command_name: "create-agent",
          original_user_input: initialText,
        }),
      );
    });
  });
});
