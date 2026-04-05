import type { AgentStatus } from "@/core/agents";

export function buildWorkspaceAgentAuthoringPath({
  agentName,
  agentStatus,
  threadId,
}: {
  agentName: string;
  agentStatus?: AgentStatus;
  threadId?: string;
}) {
  const params = new URLSearchParams();
  if (agentStatus) {
    params.set("agent_status", agentStatus);
  }
  if (threadId?.trim()) {
    params.set("thread_id", threadId.trim());
  }
  const query = params.toString();
  const pathname = `/workspace/agents/${encodeURIComponent(agentName)}/authoring`;
  return query ? `${pathname}?${query}` : pathname;
}

export function buildWorkspaceSkillAuthoringPath({
  skillName,
  sourcePath,
  threadId,
}: {
  skillName: string;
  sourcePath?: string | null;
  threadId?: string;
}) {
  const params = new URLSearchParams();
  if (sourcePath?.trim()) {
    params.set("source_path", sourcePath.trim());
  }
  if (threadId?.trim()) {
    params.set("thread_id", threadId.trim());
  }
  const query = params.toString();
  const pathname = `/workspace/skills/${encodeURIComponent(skillName)}/authoring`;
  return query ? `${pathname}?${query}` : pathname;
}
