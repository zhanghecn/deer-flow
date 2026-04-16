import { authFetch } from "@/core/auth/fetch";
import { getBackendBaseURL } from "@/core/config";

import type {
  CreateMCPProfileRequest,
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
