import type { Page, Route } from "@playwright/test";

const authState = {
  token: "pw-test-token",
  user: {
    id: "pw-user",
    email: "pw@example.com",
    name: "Playwright User",
    role: "admin",
  },
};

const localSettings = {
  notification: {
    enabled: false,
  },
  context: {
    model_name: "kimi-k2.5",
    mode: "pro",
    reasoning_effort: "high",
    agent_status: "dev",
  },
  layout: {
    sidebar_collapsed: false,
  },
};

const models = {
  models: [
    {
      id: "kimi-k2.5",
      name: "kimi-k2.5",
      display_name: "Kimi K2.5",
      supports_thinking: true,
      supports_reasoning_effort: true,
    },
  ],
};

const skills = {
  skills: [
    {
      name: "framework-selection",
      description: "Pick the right framework for the task.",
      category: "coding",
      license: "MIT",
      enabled: true,
    },
    {
      name: "frontend-design",
      description: "Build polished UI quickly.",
      category: "design/ui",
      license: "MIT",
      enabled: true,
    },
  ],
};

async function fulfillJson(route: Route, json: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(json),
  });
}

export async function bootstrapWorkspace(page: Page) {
  await page.addInitScript(
    ([nextAuthState, nextLocalSettings]) => {
      window.localStorage.setItem(
        "openagents-auth",
        JSON.stringify(nextAuthState),
      );
      window.localStorage.setItem(
        "openagents.local-settings",
        JSON.stringify(nextLocalSettings),
      );
      document.cookie = "locale=en-US; path=/";
    },
    [authState, localSettings],
  );

  await page.route("**/api/models", (route) => fulfillJson(route, models));
  await page.route("**/api/skills", (route) => fulfillJson(route, skills));
  await page.route("**/api/agents/check**", (route) =>
    fulfillJson(route, { available: true, name: "pw-agent" }),
  );
  await page.route("**/api/agents**", (route) =>
    fulfillJson(route, { agents: [] }),
  );
  await page.route("**/api/threads/search", (route) => fulfillJson(route, []));
  await page.route("**/api/mcp/config", (route) =>
    fulfillJson(route, { mcp_servers: {} }),
  );
}
