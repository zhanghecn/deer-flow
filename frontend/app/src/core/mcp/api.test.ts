import { describe, expect, it, vi } from "vitest";

import {
  createMCPProfile,
  deleteMCPProfile,
  getMCPProfile,
  listMCPProfiles,
  updateMCPProfile,
} from "./api";

vi.mock("@/core/auth/fetch", () => ({
  authFetch: vi.fn(async (_url: string, init?: RequestInit) => {
    const url = String(_url);
    const method = init?.method ?? "GET";
    if (method === "POST") {
      return {
        json: async () => ({
          name: "customer-docs",
          server_name: "customer-docs",
          category: "custom",
          source_path: "custom/mcp-profiles/customer-docs.json",
          can_edit: true,
          config_json: {
            mcpServers: {
              "customer-docs": {
                type: "http",
                url: "https://customer.example.com/mcp",
              },
            },
          },
        }),
      };
    }
    if (method === "PUT") {
      return {
        json: async () => ({
          name: "customer-docs",
          server_name: "customer-docs",
          can_edit: true,
          config_json: { mcpServers: {} },
        }),
      };
    }
    if (method === "DELETE") {
      return { json: async () => ({}) };
    }
    if (url.includes("/api/mcp/profiles/customer-docs")) {
      return {
        json: async () => ({
          name: "customer-docs",
          server_name: "customer-docs",
          category: "custom",
          source_path: "custom/mcp-profiles/customer-docs.json",
          can_edit: true,
          config_json: { mcpServers: {} },
        }),
      };
    }
    return {
      json: async () => ({
        profiles: [
          {
            name: "customer-docs",
            server_name: "customer-docs",
            category: "custom",
            source_path: "custom/mcp-profiles/customer-docs.json",
            can_edit: true,
            config_json: { mcpServers: {} },
          },
        ],
      }),
    };
  }),
}));

describe("mcp profile api", () => {
  it("lists profiles", async () => {
    const profiles = await listMCPProfiles();
    expect(profiles[0]?.source_path).toBe(
      "custom/mcp-profiles/customer-docs.json",
    );
  });

  it("creates and updates profiles", async () => {
    const created = await createMCPProfile({
      name: "customer-docs",
      config_json: { mcpServers: {} },
    });
    expect(created.server_name).toBe("customer-docs");

    const updated = await updateMCPProfile("customer-docs", {
      config_json: { mcpServers: {} },
    });
    expect(updated.name).toBe("customer-docs");
  });

  it("gets and deletes profiles", async () => {
    const profile = await getMCPProfile("customer-docs");
    expect(profile.name).toBe("customer-docs");
    await expect(deleteMCPProfile("customer-docs")).resolves.toBeUndefined();
  });
});
