import { authFetch } from "@/core/auth/fetch";
import { getBackendBaseURL, getLangGraphBaseURL } from "@/core/config";

import type {
  CreateMCPProfileRequest,
  MCPProfileDiscoveryRequestItem,
  MCPProfileDiscoveryResult,
  MCPProfile,
  UpdateMCPProfileRequest,
} from "./types";

function normalizeMCPProfile(payload: unknown): MCPProfile {
  const record =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return {
    name: typeof record.name === "string" ? record.name : "",
    server_name: typeof record.server_name === "string" ? record.server_name : "",
    category: typeof record.category === "string" ? record.category : undefined,
    source_path:
      typeof record.source_path === "string" ? record.source_path : undefined,
    can_edit: record.can_edit === true,
    config_json:
      record.config_json && typeof record.config_json === "object"
        ? (record.config_json as Record<string, unknown>)
        : {},
  };
}

function normalizeMCPProfiles(payload: unknown): MCPProfile[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const record = payload as Record<string, unknown>;
  const rawProfiles = record.profiles;
  if (!Array.isArray(rawProfiles)) {
    return [];
  }
  return rawProfiles.map((item) => normalizeMCPProfile(item));
}

function normalizeDiscoveredTool(payload: unknown) {
  const record =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  return {
    name: typeof record.name === "string" ? record.name : "",
    description: typeof record.description === "string" ? record.description : "",
    input_schema:
      record.input_schema && typeof record.input_schema === "object"
        ? (record.input_schema as Record<string, unknown>)
        : {},
  };
}

function normalizeDiscoveryResult(payload: unknown): MCPProfileDiscoveryResult {
  const record =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  return {
    ref: typeof record.ref === "string" ? record.ref : "",
    profile_name:
      typeof record.profile_name === "string" ? record.profile_name : "",
    server_name:
      typeof record.server_name === "string" ? record.server_name : undefined,
    reachable: record.reachable === true,
    latency_ms:
      typeof record.latency_ms === "number" ? record.latency_ms : undefined,
    tool_count: typeof record.tool_count === "number" ? record.tool_count : 0,
    tools: Array.isArray(record.tools)
      ? record.tools.map((item) => normalizeDiscoveredTool(item))
      : [],
    error: typeof record.error === "string" ? record.error : undefined,
  };
}

export async function listMCPProfiles() {
  const response = await authFetch(`${getBackendBaseURL()}/api/mcp/profiles`);
  return normalizeMCPProfiles(await response.json());
}

export async function getMCPProfile(
  name: string,
  sourcePath?: string | null,
): Promise<MCPProfile> {
  const query = sourcePath?.trim()
    ? `?source_path=${encodeURIComponent(sourcePath.trim())}`
    : "";
  const response = await authFetch(
    `${getBackendBaseURL()}/api/mcp/profiles/${encodeURIComponent(name)}${query}`,
  );
  return normalizeMCPProfile(await response.json());
}

export async function createMCPProfile(
  request: CreateMCPProfileRequest,
): Promise<MCPProfile> {
  const response = await authFetch(`${getBackendBaseURL()}/api/mcp/profiles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  return normalizeMCPProfile(await response.json());
}

export async function updateMCPProfile(
  name: string,
  request: UpdateMCPProfileRequest,
): Promise<MCPProfile> {
  const response = await authFetch(
    `${getBackendBaseURL()}/api/mcp/profiles/${encodeURIComponent(name)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );
  return normalizeMCPProfile(await response.json());
}

export async function deleteMCPProfile(name: string): Promise<void> {
  await authFetch(`${getBackendBaseURL()}/api/mcp/profiles/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

export async function discoverMCPProfiles(
  profiles: MCPProfileDiscoveryRequestItem[],
): Promise<MCPProfileDiscoveryResult[]> {
  const response = await authFetch(`${getLangGraphBaseURL()}/api/tools/mcp/discover`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ profiles }),
  });
  const payload = await response.json();
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const rawResults = (payload as Record<string, unknown>).results;
  if (!Array.isArray(rawResults)) {
    return [];
  }
  return rawResults.map((item) => normalizeDiscoveryResult(item));
}
