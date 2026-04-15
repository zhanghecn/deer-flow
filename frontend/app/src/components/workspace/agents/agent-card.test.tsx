import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentCard } from "./agent-card";

const deleteMutateAsync = vi.fn();
const publishMutateAsync = vi.fn();

vi.mock("@/core/agents", () => ({
  buildWorkspaceAgentPath: () => "/workspace/agents/reviewer/chats/new",
  buildWorkspaceAgentSettingsPath: () => "/workspace/agents/reviewer/settings",
  getAgentDirectoryDefaultTarget: (agent: { defaultChatStatus: "dev" | "prod" }) =>
    agent.defaultChatStatus === "dev" ? "draft" : "published",
  getAgentDirectoryAvailability: (
    agent: { statuses: Array<"dev" | "prod"> },
  ) => {
    if (agent.statuses.includes("dev") && agent.statuses.includes("prod")) {
      return "publishedReady";
    }
    return agent.statuses.includes("dev") ? "draftOnly" : "publishedOnly";
  },
  useDeleteAgent: () => ({
    mutateAsync: deleteMutateAsync,
    isPending: false,
  }),
  usePublishAgent: () => ({
    mutateAsync: publishMutateAsync,
    isPending: false,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    t: {
      agents: {
        coreBadge: "core",
        delete: "Delete",
        readOnlyBadge: "read only",
        defaultDraft: "Draft default",
        defaultPublished: "Published default",
        draftOnly: "Draft only",
        publishedReady: "Published ready",
        publishedOnly: "Published only",
        deleteArchiveTitle: (agentName: string) =>
          `Delete "${agentName}" archives`,
        deleteArchiveDescription: (agentName: string) =>
          `Choose which archived copy of "${agentName}" to remove.`,
        deleteDraft: "Delete draft",
        deletePublished: "Delete published",
        deleteAllArchives: "Delete all archives",
        deleteDraftSuccess: (agentName: string) =>
          `Deleted draft archive for "${agentName}"`,
        deletePublishedSuccess: (agentName: string) =>
          `Deleted published archive for "${agentName}"`,
        deleteAllArchivesSuccess: (agentName: string) =>
          `Deleted all archives for "${agentName}"`,
        startChatting: "Start chatting",
        publishToProd: "Publish to prod",
        publishSuccess: () => "Published",
        switcher: {
          builtinDescription: "Built-in orchestration agent",
        },
      },
      common: {
        cancel: "Cancel",
        settings: "Settings",
      },
    },
  }),
}));

describe("AgentCard", () => {
  beforeEach(() => {
    deleteMutateAsync.mockReset();
    publishMutateAsync.mockReset();
  });

  it("shows one aggregated card with draft-first actions for manageable agents", () => {
    render(
      <MemoryRouter>
        <AgentCard
          agent={{
            name: "reviewer",
            description: "Review contracts",
            statuses: ["dev", "prod"],
            devAgent: {
              name: "reviewer",
              description: "Review contracts",
              model: null,
              tool_groups: null,
              status: "dev",
              can_manage: true,
            },
            prodAgent: {
              name: "reviewer",
              description: "Review contracts",
              model: null,
              tool_groups: null,
              status: "prod",
              can_manage: true,
            },
            defaultChatStatus: "dev",
            defaultSettingsStatus: "dev",
            hasPublishedVersion: true,
            canManage: true,
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Review contracts")).toBeInTheDocument();
    expect(screen.getAllByText("Draft default")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Published ready")[0]).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start chatting" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Publish to prod" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("hides management actions for read-only published agents", () => {
    render(
      <MemoryRouter>
        <AgentCard
          agent={{
            name: "reviewer",
            description: "Review contracts",
            statuses: ["dev", "prod"],
            devAgent: {
              name: "reviewer",
              description: "Review contracts",
              model: null,
              tool_groups: null,
              status: "dev",
              can_manage: false,
            },
            prodAgent: {
              name: "reviewer",
              description: "Review contracts",
              model: null,
              tool_groups: null,
              status: "prod",
              can_manage: false,
            },
            defaultChatStatus: "prod",
            defaultSettingsStatus: "dev",
            hasPublishedVersion: true,
            canManage: false,
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("read only")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start chatting" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Settings" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Publish to prod" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Published default")[0]).toBeInTheDocument();
  });

  it("offers archive-specific delete actions for grouped agents", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <AgentCard
          agent={{
            name: "reviewer",
            description: "Review contracts",
            statuses: ["dev", "prod"],
            devAgent: {
              name: "reviewer",
              description: "Review contracts",
              model: null,
              tool_groups: null,
              status: "dev",
              can_manage: true,
            },
            prodAgent: {
              name: "reviewer",
              description: "Review contracts",
              model: null,
              tool_groups: null,
              status: "prod",
              can_manage: true,
            },
            defaultChatStatus: "dev",
            defaultSettingsStatus: "dev",
            hasPublishedVersion: true,
            canManage: true,
          }}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(
      screen.getByRole("heading", { name: 'Delete "reviewer" archives' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete draft" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete published" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete all archives" }),
    ).toBeInTheDocument();
  });

  it("deletes only the requested archive status", async () => {
    const user = userEvent.setup();
    deleteMutateAsync.mockResolvedValue(undefined);

    render(
      <MemoryRouter>
        <AgentCard
          agent={{
            name: "reviewer",
            description: "Review contracts",
            statuses: ["dev", "prod"],
            devAgent: {
              name: "reviewer",
              description: "Review contracts",
              model: null,
              tool_groups: null,
              status: "dev",
              can_manage: true,
            },
            prodAgent: {
              name: "reviewer",
              description: "Review contracts",
              model: null,
              tool_groups: null,
              status: "prod",
              can_manage: true,
            },
            defaultChatStatus: "dev",
            defaultSettingsStatus: "dev",
            hasPublishedVersion: true,
            canManage: true,
          }}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete draft" }));

    expect(deleteMutateAsync).toHaveBeenCalledWith({
      name: "reviewer",
      status: "dev",
    });
  });
});
