import type { ToolCatalogItem } from "@/core/agents";

function parseToolGroupsCSV(groupsCSV: string) {
  return groupsCSV
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function deriveToolNamesFromGroups(
  groupsCSV: string,
  catalog: ToolCatalogItem[],
  capability: "main" | "subagent",
) {
  const groups = new Set(parseToolGroupsCSV(groupsCSV));
  if (groups.size === 0) {
    return [];
  }
  return catalog
    .filter((tool) =>
      capability === "main"
        ? tool.configurable_for_main_agent
        : tool.configurable_for_subagent,
    )
    .filter((tool) => groups.has(tool.group))
    .map((tool) => tool.name);
}

export function resolveEffectiveToolNames(
  config: {
    toolSelectionEnabled: boolean;
    toolNames: string[];
    toolGroups: string;
  },
  catalog: ToolCatalogItem[],
  capability: "main" | "subagent",
) {
  if (config.toolSelectionEnabled) {
    return config.toolNames;
  }

  const derivedFromGroups = deriveToolNamesFromGroups(
    config.toolGroups,
    catalog,
    capability,
  );
  if (derivedFromGroups.length > 0) {
    return derivedFromGroups;
  }

  // Archives without an explicit override should inherit the current catalog
  // instead of freezing an older snapshot of whichever tools existed before.
  return catalog.map((tool) => tool.name);
}
