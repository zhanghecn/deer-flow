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

const UNPUBLISHED_PUBLIC_AGENT_DOCS_MESSAGE =
  "Published agent docs are only available after the agent is published to prod.";

function resolveAPIErrorMessage(
  payload: APIErrorShape,
  fallback: string,
): string {
  return payload.details ?? payload.detail ?? payload.error ?? fallback;
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
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(resolveAPIErrorMessage(err, `Agent '${name}' not found`));
  }
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

export async function deleteAgent(
  name: string,
  status?: AgentStatus,
): Promise<void> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await authFetch(
    `${getBackendBaseURL()}/api/agents/${name}${query}`,
    {
      method: "DELETE",
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(
      resolveAPIErrorMessage(err, `Failed to delete agent: ${res.statusText}`),
    );
  }
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

export async function getPublicAgentExportDoc(
  name: string,
): Promise<AgentExportDoc> {
  const res = await fetch(`${getBackendBaseURL()}/open/agents/${name}/export`);
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(UNPUBLISHED_PUBLIC_AGENT_DOCS_MESSAGE);
    }
    const err = (await res.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(
      resolveAPIErrorMessage(
        err,
        `Failed to load public export document: ${res.statusText}`,
      ),
    );
  }
  return res.json() as Promise<AgentExportDoc>;
}

export { UNPUBLISHED_PUBLIC_AGENT_DOCS_MESSAGE };
