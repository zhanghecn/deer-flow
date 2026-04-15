import { describe, expect, it } from "vitest";

import { groupAgentsByName } from "./directory";
import type { Agent } from "./types";

function createAgent(overrides: Partial<Agent> & Pick<Agent, "name" | "status">): Agent {
  // Keep required identity fields explicit so the helper cannot accidentally
  // shadow them through a later object spread when TypeScript tightens checks.
  const { name, status, ...rest } = overrides;

  return {
    description: "",
    model: null,
    tool_groups: null,
    ...rest,
    name,
    status,
  };
}

describe("groupAgentsByName", () => {
  it("defaults manageable agents to dev chat and settings when both archives exist", () => {
    const entries = groupAgentsByName([
      createAgent({ name: "reviewer", status: "prod", can_manage: true }),
      createAgent({ name: "reviewer", status: "dev", can_manage: true }),
    ]);

    expect(entries.find((entry) => entry.name === "reviewer")).toMatchObject({
      defaultChatStatus: "dev",
      defaultSettingsStatus: "dev",
      hasPublishedVersion: true,
      canManage: true,
    });
  });

  it("defaults read-only users to prod when a published archive exists", () => {
    const entries = groupAgentsByName([
      createAgent({ name: "reviewer", status: "prod", can_manage: false }),
      createAgent({ name: "reviewer", status: "dev", can_manage: false }),
    ]);

    expect(entries.find((entry) => entry.name === "reviewer")).toMatchObject({
      defaultChatStatus: "prod",
      defaultSettingsStatus: "dev",
      hasPublishedVersion: true,
      canManage: false,
    });
  });

  it("keeps dev-only agents on the draft archive", () => {
    const entries = groupAgentsByName([
      createAgent({ name: "reviewer", status: "dev", can_manage: true }),
    ]);

    expect(entries.find((entry) => entry.name === "reviewer")).toMatchObject({
      statuses: ["dev"],
      defaultChatStatus: "dev",
      defaultSettingsStatus: "dev",
      hasPublishedVersion: false,
    });
  });

  it("treats missing can_manage as read-only instead of manageable", () => {
    const entries = groupAgentsByName([
      createAgent({ name: "reviewer", status: "dev" }),
      createAgent({ name: "reviewer", status: "prod" }),
    ]);

    expect(entries.find((entry) => entry.name === "reviewer")).toMatchObject({
      defaultChatStatus: "prod",
      defaultSettingsStatus: "dev",
      hasPublishedVersion: true,
      canManage: false,
    });
  });
});
