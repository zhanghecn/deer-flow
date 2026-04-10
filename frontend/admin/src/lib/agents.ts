import type { Agent, AgentStatus } from "@/types";

export interface AgentRecord {
  name: string;
  draft: Agent | null;
  published: Agent | null;
}

export interface AgentVersionBadge {
  label: string;
  variant: "default" | "secondary" | "outline";
}

// Collapse archive-specific rows into one operator-facing record so the admin
// list matches how users think about "an agent" rather than "two statuses".
export function buildAgentRecords(agents: Agent[]): AgentRecord[] {
  const records = new Map<string, AgentRecord>();

  for (const agent of agents) {
    const current = records.get(agent.name) ?? createAgentRecord(agent.name);
    mergeAgentIntoRecord(current, agent);
    records.set(agent.name, current);
  }

  return Array.from(records.values()).sort(compareAgentRecords);
}

export function getAvailableAgentStatuses(record: AgentRecord): AgentStatus[] {
  return [
    ...(record.draft ? (["dev"] as const) : []),
    ...(record.published ? (["prod"] as const) : []),
  ];
}

export function getPreferredAgentStatus(record: AgentRecord): AgentStatus {
  return record.draft ? "dev" : "prod";
}

export function getPrimaryAgent(record: AgentRecord): Agent | null {
  return record.draft ?? record.published;
}

export function getAgentVersionBadges(record: AgentRecord): AgentVersionBadge[] {
  if (record.draft && record.published) {
    return [
      { label: "Draft default", variant: "secondary" },
      { label: "Published ready", variant: "default" },
    ];
  }
  if (record.draft) {
    return [{ label: "Draft only", variant: "secondary" }];
  }
  return [{ label: "Published only", variant: "outline" }];
}

function createAgentRecord(name: string): AgentRecord {
  return {
    name,
    draft: null,
    published: null,
  };
}

function mergeAgentIntoRecord(record: AgentRecord, agent: Agent) {
  if (agent.status === "prod") {
    record.published = agent;
    return;
  }
  record.draft = agent;
}

function compareAgentRecords(left: AgentRecord, right: AgentRecord) {
  if (left.name === "lead_agent") {
    return -1;
  }
  if (right.name === "lead_agent") {
    return 1;
  }
  return left.name.localeCompare(right.name);
}
