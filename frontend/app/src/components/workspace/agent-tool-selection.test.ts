import { describe, expect, it } from "vitest";

import type { ToolCatalogItem } from "@/core/agents";

import {
  deriveToolNamesFromGroups,
  resolveEffectiveToolNames,
} from "./agent-tool-selection";

const TOOL_CATALOG: ToolCatalogItem[] = [
  {
    name: "question",
    group: "interaction",
    label: "Question",
    description: "Ask a structured question.",
    configurable_for_main_agent: true,
    configurable_for_subagent: false,
    reserved_policy: "main_agent_only",
  },
  {
    name: "web_search",
    group: "web",
    label: "Web Search",
    description: "Search the web.",
    configurable_for_main_agent: true,
    configurable_for_subagent: true,
    reserved_policy: "normal",
  },
  {
    name: "image_search",
    group: "web",
    label: "Image Search",
    description: "Search for images.",
    configurable_for_main_agent: true,
    configurable_for_subagent: true,
    reserved_policy: "normal",
  },
];

describe("agent tool selection helpers", () => {
  it("derives only tools from the requested groups and capability", () => {
    expect(deriveToolNamesFromGroups("web", TOOL_CATALOG, "subagent")).toEqual([
      "web_search",
      "image_search",
    ]);
  });

  it("inherits the full current catalog when explicit tool selection is disabled", () => {
    expect(
      resolveEffectiveToolNames(
        {
          toolSelectionEnabled: false,
          toolNames: [],
          toolGroups: "",
        },
        TOOL_CATALOG,
        "main",
      ),
    ).toEqual(["question", "web_search", "image_search"]);
  });

  it("preserves an explicit override when tool selection is enabled", () => {
    expect(
      resolveEffectiveToolNames(
        {
          toolSelectionEnabled: true,
          toolNames: ["web_search"],
          toolGroups: "",
        },
        TOOL_CATALOG,
        "main",
      ),
    ).toEqual(["web_search"]);
  });
});
