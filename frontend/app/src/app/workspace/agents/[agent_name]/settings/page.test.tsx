import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import AgentSettingsPage from "./page";

const dialogMock = vi.fn();

vi.mock("@/components/workspace/agents/agent-gallery", () => ({
  AgentGallery: () => <div data-testid="agent-gallery" />,
}));

vi.mock("@/components/workspace/agent-settings-dialog", () => ({
  AgentSettingsDialog: (props: {
    open: boolean;
    agentName: string;
    agentStatus: "dev" | "prod";
    executionBackend?: "remote";
    remoteSessionId?: string;
    onOpenChange: (open: boolean) => void;
  }) => {
    dialogMock(props);
    return (
      <div>
        <div data-testid="agent-settings-dialog">
          {props.agentName}:{props.agentStatus}:{props.executionBackend ?? "local"}:
          {props.remoteSessionId ?? ""}
        </div>
        <button type="button" onClick={() => props.onOpenChange(false)}>
          close settings
        </button>
      </div>
    );
  },
}));

describe("AgentSettingsPage", () => {
  it("renders the gallery and opens the selected agent settings route", () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/workspace/agents/reviewer/settings?agent_status=prod&execution_backend=remote&remote_session_id=remote-1",
        ]}
      >
        <Routes>
          <Route
            path="/workspace/agents/:agent_name/settings"
            element={<AgentSettingsPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("agent-gallery")).toBeInTheDocument();
    expect(screen.getByTestId("agent-settings-dialog")).toHaveTextContent(
      "reviewer:prod:remote:remote-1",
    );
    expect(dialogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        open: true,
        agentName: "reviewer",
        agentStatus: "prod",
        executionBackend: "remote",
        remoteSessionId: "remote-1",
      }),
    );
  });

  it("returns to the agent gallery when the settings dialog closes", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter
        initialEntries={["/workspace/agents/reviewer/settings?agent_status=dev"]}
      >
        <Routes>
          <Route path="/workspace/agents" element={<div>agent gallery route</div>} />
          <Route
            path="/workspace/agents/:agent_name/settings"
            element={<AgentSettingsPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /close settings/i }));

    expect(screen.getByText("agent gallery route")).toBeInTheDocument();
  });
});
