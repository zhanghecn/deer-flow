import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ToolSettingsPage } from "./tool-settings-page";

vi.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    t: {
      common: {
        loading: "Loading",
      },
      settings: {
        tools: {
          title: "Tools",
          description: "Manage the global MCP library that agents can bind to.",
          loadError: (message: string) => message,
          emptyState: "No MCP profiles are configured yet.",
          createProfile: "Create MCP",
          editProfile: "Edit MCP",
          profileCreated: "MCP profile created",
          profileUpdated: "MCP profile updated",
          profileDeleted: "MCP profile deleted",
          profileName: "Profile name",
          profileConfig: "Canonical mcpServers JSON",
          saveProfile: "Save MCP profile",
          saveError: "Failed to save MCP profile",
        },
      },
    },
  }),
}));

vi.mock("@/core/mcp/hooks", () => ({
  useMCPProfiles: () => ({
    profiles: [
      {
        name: "customer-docs",
        server_name: "customer-docs",
        category: "custom",
        source_path: "custom/mcp-profiles/customer-docs.json",
        can_edit: true,
        config_json: { mcpServers: {} },
      },
    ],
    isLoading: false,
    error: null,
  }),
  useCreateMCPProfile: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useUpdateMCPProfile: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useDeleteMCPProfile: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

describe("ToolSettingsPage", () => {
  it("renders MCP library profiles from the new profiles hook", () => {
    render(<ToolSettingsPage />);

    expect(
      screen.getByText("Manage the global MCP library that agents can bind to."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create MCP" })).toBeInTheDocument();
    expect(screen.getByText("customer-docs")).toBeInTheDocument();
    expect(
      screen.getByText(/custom\/mcp-profiles\/customer-docs\.json/),
    ).toBeInTheDocument();
  });
});
