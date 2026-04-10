import type { Agent, AgentStatus } from "./types";

export interface AgentDirectoryEntry {
  name: string;
  description: string;
  statuses: AgentStatus[];
  devAgent: Agent | null;
  prodAgent: Agent | null;
  defaultChatStatus: AgentStatus;
  defaultSettingsStatus: AgentStatus;
  hasPublishedVersion: boolean;
  canManage: boolean;
}

export type AgentDirectoryDefaultTarget = "draft" | "published";
export type AgentDirectoryAvailability = "draftOnly" | "publishedReady" | "publishedOnly";

export function groupAgentsByName(agents: Agent[]): AgentDirectoryEntry[] {
  const byName = new Map<string, AgentDirectoryEntry>();

  for (const agent of agents) {
    const entry = byName.get(agent.name) ?? createAgentDirectoryEntry(agent.name);
    mergeAgentIntoDirectoryEntry(entry, agent);
    byName.set(agent.name, entry);
  }

  if (!byName.has("lead_agent")) {
    byName.set("lead_agent", createBuiltinLeadAgentDirectoryEntry());
  }

  return [...byName.values()]
    .map(finalizeAgentDirectoryEntry)
    .sort(compareAgentDirectoryEntries);
}

export function createBuiltinLeadAgentDirectoryEntry(): AgentDirectoryEntry {
  return {
    name: "lead_agent",
    description: "Built-in orchestration agent",
    statuses: ["dev", "prod"],
    devAgent: null,
    prodAgent: null,
    defaultChatStatus: "dev",
    defaultSettingsStatus: "dev",
    hasPublishedVersion: true,
    canManage: true,
  };
}

export function getAgentDirectoryDefaultTarget(
  entry: AgentDirectoryEntry,
): AgentDirectoryDefaultTarget {
  return entry.defaultChatStatus === "dev" ? "draft" : "published";
}

export function getAgentDirectoryAvailability(
  entry: AgentDirectoryEntry,
): AgentDirectoryAvailability {
  if (entry.statuses.includes("dev") && entry.statuses.includes("prod")) {
    return "publishedReady";
  }
  return entry.statuses.includes("dev") ? "draftOnly" : "publishedOnly";
}

export function pickAgentStatus(
  requestedStatus: string | null | undefined,
  statuses: AgentStatus[],
) {
  if (requestedStatus === "prod" && statuses.includes("prod")) {
    return "prod";
  }
  if (statuses.includes("dev")) {
    return "dev";
  }
  return statuses[0] ?? "dev";
}

function createAgentDirectoryEntry(name: string): AgentDirectoryEntry {
  return {
    name,
    description: "",
    statuses: [],
    devAgent: null,
    prodAgent: null,
    defaultChatStatus: "dev",
    defaultSettingsStatus: "dev",
    hasPublishedVersion: false,
    canManage: false,
  };
}

function mergeAgentIntoDirectoryEntry(
  entry: AgentDirectoryEntry,
  agent: Agent,
) {
  const description = agent.description?.trim() ?? "";

  if (agent.status === "dev") {
    entry.devAgent = agent;
  } else {
    entry.prodAgent = agent;
  }

  if (!entry.statuses.includes(agent.status)) {
    entry.statuses = [...entry.statuses, agent.status].sort(
      compareAgentStatuses,
    );
  }

  if (!entry.description && description) {
    entry.description = description;
  }
}

function finalizeAgentDirectoryEntry(
  entry: AgentDirectoryEntry,
): AgentDirectoryEntry {
  return {
    ...entry,
    defaultChatStatus: pickDefaultChatStatus(entry),
    // Settings stay anchored to the editable archive when it exists so the
    // gallery does not push authors into prod for routine configuration work.
    defaultSettingsStatus: pickDefaultSettingsStatus(entry),
    hasPublishedVersion: entry.prodAgent != null || entry.statuses.includes("prod"),
    canManage: canManageAgentDirectoryEntry(entry),
  };
}

function pickDefaultChatStatus(entry: AgentDirectoryEntry): AgentStatus {
  // When authors have a draft archive, new chats should land there by default.
  // Read-only viewers fall back to prod so the workspace opens the published copy.
  if (entry.devAgent?.can_manage !== false) {
    return "dev";
  }
  if (entry.prodAgent) {
    return "prod";
  }
  if (entry.devAgent) {
    return "dev";
  }
  return pickAgentStatus("dev", entry.statuses);
}

function pickDefaultSettingsStatus(entry: AgentDirectoryEntry): AgentStatus {
  return entry.devAgent ? "dev" : pickAgentStatus("prod", entry.statuses);
}

function canManageAgentDirectoryEntry(entry: AgentDirectoryEntry) {
  return (
    entry.devAgent?.can_manage !== false ||
    entry.prodAgent?.can_manage !== false ||
    (entry.devAgent == null &&
      entry.prodAgent == null &&
      entry.name === "lead_agent")
  );
}

function compareAgentDirectoryEntries(
  left: AgentDirectoryEntry,
  right: AgentDirectoryEntry,
) {
  if (left.name === "lead_agent") return -1;
  if (right.name === "lead_agent") return 1;
  return left.name.localeCompare(right.name);
}

function compareAgentStatuses(left: AgentStatus, right: AgentStatus) {
  if (left === right) {
    return 0;
  }
  return left === "dev" ? -1 : 1;
}
