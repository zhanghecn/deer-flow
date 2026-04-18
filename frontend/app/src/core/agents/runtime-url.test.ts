import { describe, expect, it } from "vitest";

import {
  buildWorkspaceAgentPath,
  buildWorkspaceAgentPlaygroundPath,
  buildWorkspaceAgentSettingsPath,
} from "./runtime-url";

describe("agent runtime urls", () => {
  it("builds workspace settings paths with explicit runtime selection", () => {
    expect(
      buildWorkspaceAgentSettingsPath({
        agentName: "reviewer",
        agentStatus: "prod",
        executionBackend: "remote",
        remoteSessionId: "remote-1",
      }),
    ).toBe(
      "/workspace/agents/reviewer/settings?agent_status=prod&execution_backend=remote&remote_session_id=remote-1",
    );
  });

  it("builds workspace settings paths for lead_agent explicitly", () => {
    expect(
      buildWorkspaceAgentSettingsPath({
        agentName: "lead_agent",
        agentStatus: "dev",
      }),
    ).toBe("/workspace/agents/lead_agent/settings?agent_status=dev");
  });

  it("builds standalone playground paths with the same runtime selection", () => {
    expect(
      buildWorkspaceAgentPlaygroundPath({
        agentName: "reviewer",
        agentStatus: "prod",
        executionBackend: "remote",
        remoteSessionId: "remote-1",
      }),
    ).toBe(
      "/workspace/agents/reviewer/playground?agent_status=prod&execution_backend=remote&remote_session_id=remote-1",
    );
  });

  it("keeps chat routes separate from settings routes", () => {
    expect(
      buildWorkspaceAgentPath({
        agentName: "reviewer",
        agentStatus: "dev",
      }),
    ).toBe("/workspace/agents/reviewer/chats/new?agent_status=dev");
  });
});
