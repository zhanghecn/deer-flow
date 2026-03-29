import { authFetch } from "@/core/auth/fetch";
import { getBackendBaseURL } from "@/core/config";

import type {
  Agent,
  AgentExportDoc,
  AgentStatus,
  CreateAgentRequest,
  ToolCatalogItem,
  UpdateAgentRequest,
} from "./types";

type APIErrorShape = {
  detail?: string;
  details?: string;
  error?: string;
};

function resolveAPIErrorMessage(
  payload: APIErrorShape,
  fallback: string,
): string {
  return payload.details ?? payload.detail ?? payload.error ?? fallback;
}

function extractFilenameFromDisposition(
  headerValue: string | null,
): string | null {
  if (!headerValue) {
    return null;
  }

  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(headerValue);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const plainMatch = /filename="?([^";]+)"?/i.exec(headerValue);
  return plainMatch?.[1] ?? null;
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const objectURL = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectURL;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectURL), 1_000);
}

export async function listAgents(status?: AgentStatus): Promise<Agent[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await authFetch(`${getBackendBaseURL()}/api/agents${query}`);
  if (!res.ok) throw new Error(`Failed to load agents: ${res.statusText}`);
  const data = (await res.json()) as { agents: Agent[] };
  return data.agents;
}

export async function listToolCatalog(): Promise<ToolCatalogItem[]> {
  const res = await authFetch(`${getBackendBaseURL()}/api/tools/catalog`);
  if (!res.ok)
    throw new Error(`Failed to load tool catalog: ${res.statusText}`);
  const data = (await res.json()) as { tools: ToolCatalogItem[] };
  return data.tools;
}

export async function getAgent(
  name: string,
  status?: AgentStatus,
): Promise<Agent> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await authFetch(
    `${getBackendBaseURL()}/api/agents/${name}${query}`,
  );
  if (!res.ok) throw new Error(`Agent '${name}' not found`);
  return res.json() as Promise<Agent>;
}

export async function createAgent(request: CreateAgentRequest): Promise<Agent> {
  const res = await authFetch(`${getBackendBaseURL()}/api/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(
      resolveAPIErrorMessage(err, `Failed to create agent: ${res.statusText}`),
    );
  }
  return res.json() as Promise<Agent>;
}

export async function updateAgent(
  name: string,
  request: UpdateAgentRequest,
  status?: AgentStatus,
): Promise<Agent> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await authFetch(
    `${getBackendBaseURL()}/api/agents/${name}${query}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(
      resolveAPIErrorMessage(err, `Failed to update agent: ${res.statusText}`),
    );
  }
  return res.json() as Promise<Agent>;
}

export async function deleteAgent(name: string): Promise<void> {
  const res = await authFetch(`${getBackendBaseURL()}/api/agents/${name}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete agent: ${res.statusText}`);
}

export async function publishAgent(name: string): Promise<Agent> {
  const res = await authFetch(
    `${getBackendBaseURL()}/api/agents/${name}/publish`,
    { method: "POST" },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(
      resolveAPIErrorMessage(err, `Failed to publish agent: ${res.statusText}`),
    );
  }
  return res.json() as Promise<Agent>;
}

export async function checkAgentName(
  name: string,
): Promise<{ available: boolean; name: string }> {
  const res = await authFetch(
    `${getBackendBaseURL()}/api/agents/check?name=${encodeURIComponent(name)}`,
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(
      resolveAPIErrorMessage(
        err,
        `Failed to check agent name: ${res.statusText}`,
      ),
    );
  }
  return res.json() as Promise<{ available: boolean; name: string }>;
}

export async function getAgentExportDoc(name: string): Promise<AgentExportDoc> {
  const res = await authFetch(
    `${getBackendBaseURL()}/api/agents/${name}/export`,
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(
      resolveAPIErrorMessage(
        err,
        `Failed to load export document: ${res.statusText}`,
      ),
    );
  }
  return res.json() as Promise<AgentExportDoc>;
}

export async function downloadAgentReactDemo(name: string): Promise<string> {
  const res = await authFetch(
    `${getBackendBaseURL()}/api/agents/${name}/export/demo`,
    {
      method: "POST",
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(
      resolveAPIErrorMessage(
        err,
        `Failed to download React demo: ${res.statusText}`,
      ),
    );
  }

  const blob = await res.blob();
  const filename =
    extractFilenameFromDisposition(res.headers.get("Content-Disposition")) ??
    `${name}-react-demo.zip`;
  triggerBrowserDownload(blob, filename);
  return filename;
}
