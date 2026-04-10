import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AgentCard } from "./agent-card";

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
  usePublishAgent: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    t: {
      agents: {
        coreBadge: "core",
        readOnlyBadge: "read only",
        defaultDraft: "Draft default",
        defaultPublished: "Published default",
        draftOnly: "Draft only",
        publishedReady: "Published ready",
        publishedOnly: "Published only",
        startChatting: "Start chatting",
        publishToProd: "Publish to prod",
        publishSuccess: () => "Published",
        switcher: {
          builtinDescription: "Built-in orchestration agent",
        },
      },
      common: {
        settings: "Settings",
      },
    },
  }),
}));

describe("AgentCard", () => {
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
    expect(screen.getByText("Draft default")).toBeInTheDocument();
    expect(screen.getByText("Published ready")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start chatting" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Publish to prod" }),
    ).toBeInTheDocument();
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
    expect(screen.getByText("Published default")).toBeInTheDocument();
  });
});
