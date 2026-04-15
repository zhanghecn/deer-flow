import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { PromptInputProvider } from "@/components/ai-elements/prompt-input";
import type {
  DesignSelectionContext,
  DesignSurfaceState,
  RuntimeSurfaceState,
  WorkspaceDockState,
} from "@/core/workspace-surface/types";

import { InputBox } from "./input-box";

const mockWorkspaceSurface = vi.hoisted(
  (): {
    designSelection: DesignSelectionContext | null;
    designState: DesignSurfaceState;
    dockState: WorkspaceDockState;
    runtimeState: RuntimeSurfaceState;
    clearDesignSelection: ReturnType<typeof vi.fn>;
  } => ({
    designSelection: null,
    designState: {
      session: null,
      status: "idle",
      target_path: undefined,
      revision: null,
      last_error: null,
    },
    dockState: {
      open: false,
      activeSurface: "preview",
      widthRatio: 38,
    },
    runtimeState: {
      session: null,
      status: "idle",
      target_path: undefined,
      last_error: null,
    },
    clearDesignSelection: vi.fn(),
  }),
);

vi.mock("@/components/ui/confetti-button", () => ({
  ConfettiButton: ({ children, ...props }: ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/workspace/artifacts", () => ({
  useArtifacts: () => ({
    selectedArtifact: null,
  }),
}));

vi.mock("@/core/workspace-surface/context", () => ({
  useWorkspaceSurface: () => mockWorkspaceSurface,
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
        submit: "Submit",
        stop: "Stop",
        addAttachments: "Add attachments",
        flashMode: "Flash",
        flashModeDescription: "Fast",
        proMode: "Pro",
        proModeDescription: "Precise",
        subagentToggle: "Subtasks",
        subagentToggleDescription: "Allow delegation",
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
        executionThinking: (elapsed?: string) =>
          `Thinking${elapsed ? ` ${elapsed}` : ""}`,
        executionRunningTool: (toolName?: string, elapsed?: string) =>
          `${toolName ? `Running ${toolName}` : "Running tool"}${elapsed ? ` ${elapsed}` : ""}`,
        executionFinalizing: (elapsed?: string) =>
          `Finalizing${elapsed ? ` ${elapsed}` : ""}`,
        executionRetryCompleted: "Retry completed",
        executionRetryFailed: "Retry failed",
        executionCompleted: (elapsed?: string) =>
          elapsed ? `Completed in ${elapsed}` : "Completed",
        executionFailed: (elapsed?: string) =>
          elapsed ? `Failed after ${elapsed}` : "Failed",
        executionStopped: (elapsed?: string) =>
          elapsed ? `Stopped after ${elapsed}` : "Stopped",
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
                subagent_enabled: false,
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
                subagent_enabled: false,
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
                subagent_enabled: false,
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

  it("exposes an explicit subtask toggle and reports state changes", async () => {
    const user = userEvent.setup();
    const onContextChange = vi.fn();
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
                subagent_enabled: false,
                agent_status: "dev",
              }}
              onContextChange={onContextChange}
              onSubmit={vi.fn()}
            />
          </PromptInputProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Subtasks" }));

    expect(onContextChange).toHaveBeenCalledWith(
      expect.objectContaining({
        subagent_enabled: true,
      }),
    );
  });

  it("defaults the subtask toggle to enabled when context omits it", () => {
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

    expect(screen.getByRole("button", { name: "Subtasks" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows a stop action while streaming and routes clicks to onStop", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onStop = vi.fn();
    const queryClient = new QueryClient();

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <PromptInputProvider>
            <InputBox
              threadId="thread-test"
              status="streaming"
              context={{
                model_name: "kimi-k2.5",
                mode: "pro",
                subagent_enabled: false,
                agent_status: "dev",
              }}
              onContextChange={vi.fn()}
              onSubmit={onSubmit}
              onStop={onStop}
            />
          </PromptInputProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    const stopButton = screen.getByRole("button", { name: "Stop" });
    expect(stopButton).toHaveTextContent("Stop");

    await user.click(stopButton);

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders unified execution status in the input footer", () => {
    const queryClient = new QueryClient();

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <PromptInputProvider>
            <InputBox
              threadId="thread-test"
              status="ready"
              executionStatus={{
                event: "completed",
                phase_kind: "run",
                started_at: "2026-03-23T12:00:00Z",
                run_started_at: "2026-03-23T12:00:00Z",
                finished_at: "2026-03-23T12:00:09Z",
                total_duration_ms: 9600,
                terminal: true,
              }}
              context={{
                model_name: "kimi-k2.5",
                mode: "pro",
                subagent_enabled: false,
                agent_status: "dev",
              }}
              onContextChange={vi.fn()}
              onSubmit={vi.fn()}
            />
          </PromptInputProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText("Completed in 9.6s")).toBeInTheDocument();
  });

  it("submits explicit surface and selection context from the design workspace", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const queryClient = new QueryClient();

    mockWorkspaceSurface.designSelection = {
      surface: "design",
      target_path: "/mnt/user-data/outputs/designs/canvas.op",
      selected_node_ids: ["hero", "cta"],
      active_node_id: "hero",
      selected_nodes: [
        { id: "hero", label: "Hero" },
        { id: "cta", label: "Primary CTA" },
      ],
      selection_summary: "Hero, Primary CTA",
    };
    mockWorkspaceSurface.dockState.activeSurface = "design";
    mockWorkspaceSurface.designState.target_path =
      "/mnt/user-data/outputs/designs/canvas.op";

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <PromptInputProvider>
            <InputBox
              threadId="thread-test"
              context={{
                model_name: "kimi-k2.5",
                mode: "pro",
                subagent_enabled: false,
                agent_status: "dev",
              }}
              onContextChange={vi.fn()}
              onSubmit={onSubmit}
            />
          </PromptInputProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await user.type(screen.getByPlaceholderText("Ask anything"), "改成深色");
    await user.keyboard("{Enter}");

    expect(onSubmit).toHaveBeenCalledWith(
      {
        text: "改成深色",
        files: [],
      },
      expect.objectContaining({
        surface_context: {
          surface: "design",
          target_path: "/mnt/user-data/outputs/designs/canvas.op",
        },
        selection_context: expect.objectContaining({
          selected_node_ids: ["hero", "cta"],
          active_node_id: "hero",
          selection_summary: "Hero, Primary CTA",
        }),
      }),
    );

    mockWorkspaceSurface.designSelection = null;
    mockWorkspaceSurface.designState.target_path = undefined;
    mockWorkspaceSurface.dockState.activeSurface = "preview";
  });
});
