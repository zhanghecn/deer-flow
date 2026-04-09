import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AgentCard } from "./agent-card";

vi.mock("@/core/agents", () => ({
  buildWorkspaceAgentPath: () => "/workspace/agents/reviewer/chats/new",
  buildWorkspaceAgentSettingsPath: () => "/workspace/agents/reviewer/settings",
  useClaimAgent: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useDeleteAgent: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  usePublishAgent: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@/core/auth/hooks", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
    },
  }),
}));

vi.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    t: {
      agents: {
        memoryOff: "Memory off",
        memoryOn: "Memory on",
        memoryWithModel: (model: string) => `Memory ${model}`,
        chat: "Chat",
        copyUrl: "Copy URL",
        publish: "Publish",
        delete: "Delete",
        deleteConfirm: "Delete this agent?",
        deleteSuccess: "Deleted",
        publishSuccess: () => "Published",
        ownerBadge: "owner",
        ownedByYou: "Owned by you",
        ownedBy: (ownerName: string) => `Owned by ${ownerName}`,
        legacyOwnerless: "Unclaimed legacy agent",
        readOnlyBadge: "read only",
        claimOwnership: "Claim ownership",
        claimOwnershipSuccess: () => "Claimed",
      },
      common: {
        settings: "Settings",
        cancel: "Cancel",
        delete: "Delete",
        loading: "Loading",
      },
      clipboard: {
        linkCopied: "Copied",
        failedToCopyToClipboard: "Copy failed",
      },
    },
  }),
}));

describe("AgentCard", () => {
  it("hides management actions for non-manageable dev agents", () => {
    render(
      <MemoryRouter>
        <AgentCard
          agent={{
            name: "reviewer",
            description: "Review agent",
            model: null,
            tool_groups: [],
            status: "dev",
            can_manage: false,
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Chat" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Settings" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTitle("Copy URL")).toBeInTheDocument();
    expect(screen.queryByTitle("Publish")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Delete")).not.toBeInTheDocument();
    expect(screen.getByText("read only")).toBeInTheDocument();
  });

  it("hides management actions for non-manageable prod agents", () => {
    render(
      <MemoryRouter>
        <AgentCard
          agent={{
            name: "reviewer",
            description: "Review agent",
            model: null,
            tool_groups: [],
            status: "prod",
            can_manage: false,
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Chat" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Settings" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTitle("Delete")).not.toBeInTheDocument();
  });

  it("shows owner metadata and claim action for legacy ownerless agents", () => {
    render(
      <MemoryRouter>
        <AgentCard
          agent={{
            name: "reviewer",
            description: "Review agent",
            model: null,
            tool_groups: [],
            status: "dev",
            can_manage: true,
          }}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(/owner: Unclaimed legacy agent/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Claim ownership" }),
    ).toBeInTheDocument();
  });

  it("shows the resolved owner label for claimed agents", () => {
    render(
      <MemoryRouter>
        <AgentCard
          agent={{
            name: "reviewer",
            description: "Review agent",
            model: null,
            tool_groups: [],
            status: "dev",
            owner_user_id: "user-2",
            owner_name: "Alice",
            can_manage: false,
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(/owner: Owned by Alice/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Claim ownership" }),
    ).not.toBeInTheDocument();
  });
});
