import { authFetch } from "@/core/auth/fetch";
import { getBackendBaseURL } from "@/core/config";

import type { MCPConfig } from "./types";

function normalizeMCPConfig(payload: unknown): MCPConfig {
  if (!payload || typeof payload !== "object") {
    return { mcp_servers: {} };
  }

  const record = payload as Record<string, unknown>;
  const rawServers = record.mcp_servers ?? record.mcpServers;
  if (
    !rawServers ||
    typeof rawServers !== "object" ||
    Array.isArray(rawServers)
  ) {
    return { mcp_servers: {} };
  }

  return {
    mcp_servers: rawServers as MCPConfig["mcp_servers"],
  };
}

export async function loadMCPConfig() {
  const response = await authFetch(`${getBackendBaseURL()}/api/mcp/config`);
  return normalizeMCPConfig(await response.json());
}

export async function updateMCPConfig(config: MCPConfig) {
  const response = await authFetch(`${getBackendBaseURL()}/api/mcp/config`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
  });
  return normalizeMCPConfig(await response.json());
}
