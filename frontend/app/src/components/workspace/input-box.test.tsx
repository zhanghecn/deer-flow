import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { PromptInputProvider } from "@/components/ai-elements/prompt-input";

import { InputBox } from "./input-box";

vi.mock("@/components/ui/confetti-button", () => ({
  ConfettiButton: ({ children, ...props }: ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("./knowledge/knowledge-selector-dialog", () => ({
  KnowledgeSelectorDialog: () => <button type="button">Knowledge</button>,
}));

vi.mock("./knowledge/thread-knowledge-attachment-strip", () => ({
  ThreadKnowledgeAttachmentStrip: () => null,
}));

vi.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    locale: "en-US",
    t: {
      commands: {
        createAgent: "Create agent",
        createSkill: "Create skill",
      },
      common: {
        create: "Create",
        cancel: "Cancel",
      },
      knowledge: {
        selector: {
          button: "Knowledge",
          readyLabel: "Ready",
          selectedCount: (count: number) => `${count} selected`,
        },
      },
      inputBox: {
        placeholder: "Ask anything",
        addAttachments: "Add attachments",
        flashMode: "Flash",
        flashModeDescription: "Fast",
        proMode: "Pro",
        proModeDescription: "Precise",
        mode: "Mode",
        searchModels: "Search models",
        surpriseMe: "Surprise",
        surpriseMePrompt: "Surprise me",
        quickInsertCommandBadge: "Command",
        quickInsertCommandsLabel: "Commands",
        quickInsertSkillsLabel: "Skills",
        retryingModel: () => "Retrying model",
        retryingTool: () => "Retrying tool",
        retryingToolGeneric: () => "Retrying tool",
        retryDelay: () => "Retrying soon",
        suggestions: [],
        suggestionsCreate: [],
      },
    },
  }),
}));

vi.mock("@/core/models/hooks", () => ({
  useModels: () => ({
    models: [
      {
        id: "model-1",
        name: "kimi-k2.5",
        display_name: "Kimi K2.5",
      },
    ],
  }),
}));

vi.mock("@/core/skills/hooks", () => ({
  useSkills: () => ({
    skills: [
      {
        name: "framework-selection",
        description: "Pick a framework",
        category: "coding",
        license: "MIT",
        enabled: true,
      },
      {
        name: "frontend-design",
        description: "Build polished UI",
        category: "design/ui",
        license: "MIT",
        enabled: true,
      },
    ],
  }),
}));

describe("InputBox", () => {
  it("supports keyboard selection for slash commands", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <PromptInputProvider>
            <InputBox
              threadId="thread-test"
              context={{
                model_name: "kimi-k2.5",
                mode: "pro",
                agent_status: "dev",
              }}
              onContextChange={vi.fn()}
              onSubmit={vi.fn()}
            />
          </PromptInputProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    const textarea = screen.getByPlaceholderText("Ask anything");
    await user.type(textarea, "/create");

    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => {
      expect(textarea).toHaveValue("/create-skill ");
    });
  });

  it("submits the Surprise prompt immediately on new threads", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const queryClient = new QueryClient();

    render(
      <MemoryRouter initialEntries={["/workspace/chats/new"]}>
        <QueryClientProvider client={queryClient}>
          <PromptInputProvider>
            <InputBox
              isNewThread
              threadId="thread-new"
              context={{
                model_name: "kimi-k2.5",
                mode: "pro",
                agent_status: "dev",
              }}
              onContextChange={vi.fn()}
              onSubmit={onSubmit}
            />
          </PromptInputProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Surprise" }));

    expect(onSubmit).toHaveBeenCalledWith(
      {
        text: "Surprise me",
        files: [],
      },
      undefined,
    );
  });

  it("submits plain chat input without temporary knowledge selection payloads", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const queryClient = new QueryClient();

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <PromptInputProvider>
            <InputBox
              threadId="thread-test"
              context={{
                model_name: "kimi-k2.5",
                mode: "pro",
                agent_status: "dev",
              }}
              onContextChange={vi.fn()}
              onSubmit={onSubmit}
            />
          </PromptInputProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Knowledge" }));
    await user.type(
      screen.getByPlaceholderText("Ask anything"),
      "目录是什么？",
    );
    await user.keyboard("{Enter}");

    expect(onSubmit).toHaveBeenCalledWith(
      {
        text: "目录是什么？",
        files: [],
      },
      undefined,
    );
  });
});
