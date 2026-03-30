import type { AgentStatus } from "./types";

export type AgentExecutionBackend = "remote" | undefined;

export interface AgentRuntimeSelection {
  agentName?: string;
  agentStatus?: AgentStatus;
  executionBackend?: AgentExecutionBackend;
  remoteSessionId?: string;
}

export interface ResolvedAgentRuntimeSelection {
  agentName: string;
  agentStatus: AgentStatus;
  executionBackend: AgentExecutionBackend;
  remoteSessionId: string;
}

type SearchParamsLike = Pick<URLSearchParams, "get">;

export function isLeadAgent(agentName: string | null | undefined) {
  return !agentName || agentName === "lead_agent";
}

export function buildWorkspaceAgentPath(
  selection: AgentRuntimeSelection,
  threadId = "new",
): string {
  const params = new URLSearchParams();
  const normalizedAgentName = selection.agentName?.trim();
  const agentName =
    normalizedAgentName && normalizedAgentName.length > 0
      ? normalizedAgentName
      : "lead_agent";
  const agentStatus = selection.agentStatus ?? "dev";

  if (agentStatus) {
    params.set("agent_status", agentStatus);
  }
  if (selection.executionBackend === "remote") {
    params.set("execution_backend", "remote");
  }
  if (selection.remoteSessionId?.trim()) {
    params.set("remote_session_id", selection.remoteSessionId.trim());
  }

  const pathname = isLeadAgent(agentName)
    ? `/workspace/chats/${threadId}`
    : `/workspace/agents/${encodeURIComponent(agentName)}/chats/${threadId}`;
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function buildWorkspaceAgentSettingsPath(
  selection: AgentRuntimeSelection,
): string {
  const params = new URLSearchParams();
  const normalizedAgentName = selection.agentName?.trim();
  const agentName =
    normalizedAgentName && normalizedAgentName.length > 0
      ? normalizedAgentName
      : "lead_agent";
  const agentStatus = selection.agentStatus ?? "dev";

  params.set("agent_status", agentStatus);
  if (selection.executionBackend === "remote") {
    params.set("execution_backend", "remote");
  }
  if (selection.remoteSessionId?.trim()) {
    params.set("remote_session_id", selection.remoteSessionId.trim());
  }

  const pathname = `/workspace/agents/${encodeURIComponent(agentName)}/settings`;
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function appendWorkspacePromptParams(
  basePath: string,
  {
    prompt,
    autoSend,
  }: {
    prompt?: string;
    autoSend?: boolean;
  },
): string {
  if (!prompt?.trim() && !autoSend) {
    return basePath;
  }

  const [pathname = basePath, search = ""] = basePath.split("?", 2);
  const params = new URLSearchParams(search);
  if (prompt?.trim()) {
    params.set("prefill", prompt.trim());
  }
  if (autoSend) {
    params.set("autosend", "1");
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function readAgentRuntimeSelection(
  searchParams: SearchParamsLike,
  fallbackAgentName?: string,
): ResolvedAgentRuntimeSelection {
  const requestedStatus = searchParams.get("agent_status");
  const normalizedFallbackAgentName = fallbackAgentName?.trim();
  const requestedAgentName = searchParams.get("agent_name");
  const agentName =
    normalizedFallbackAgentName && normalizedFallbackAgentName.length > 0
      ? normalizedFallbackAgentName
      : (requestedAgentName ?? "lead_agent");

  return {
    agentName,
    agentStatus: requestedStatus === "prod" ? "prod" : "dev",
    executionBackend:
      searchParams.get("execution_backend") === "remote" ? "remote" : undefined,
    remoteSessionId: searchParams.get("remote_session_id") ?? "",
  };
}
