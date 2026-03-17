import type { Agent, AgentStatus } from "./types";

export interface AgentDirectoryEntry {
  name: string;
  description: string;
  statuses: AgentStatus[];
}

export function groupAgentsByName(agents: Agent[]): AgentDirectoryEntry[] {
  const byName = new Map<string, AgentDirectoryEntry>();

  for (const agent of agents) {
    const existing = byName.get(agent.name);
    const description = agent.description?.trim() ?? "";

    if (!existing) {
      byName.set(agent.name, {
        name: agent.name,
        description,
        statuses: [agent.status],
      });
      continue;
    }

    existing.statuses = Array.from(
      new Set<AgentStatus>([...existing.statuses, agent.status]),
    ).sort((a, b) => (a === b ? 0 : a === "dev" ? -1 : 1));

    if (!existing.description && description) {
      existing.description = description;
    }
  }

  if (!byName.has("lead_agent")) {
    byName.set("lead_agent", {
      name: "lead_agent",
      description: "Built-in orchestration agent",
      statuses: ["dev", "prod"],
    });
  }

  return [...byName.values()].sort((a, b) => {
    if (a.name === "lead_agent") return -1;
    if (b.name === "lead_agent") return 1;
    return a.name.localeCompare(b.name);
  });
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
