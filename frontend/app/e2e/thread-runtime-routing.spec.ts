import { expect, test, type Page, type Route } from "@playwright/test";

import { bootstrapWorkspace } from "./helpers";

async function fulfillJson(route: Route, json: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(json),
  });
}

async function bootstrapThreadRuntimeFixtures(page: Page) {
  await bootstrapWorkspace(page);

  await page.route("**/api/threads/search", (route) =>
    fulfillJson(route, [
      {
        thread_id: "thread-custom",
        updated_at: "2026-03-19T00:00:00.000Z",
        values: { title: "Reviewer thread" },
        agent_name: "reviewer",
        agent_status: "prod",
      },
      {
        thread_id: "thread-lead",
        updated_at: "2026-03-18T00:00:00.000Z",
        values: { title: "Lead thread" },
        agent_name: "lead_agent",
        agent_status: "dev",
      },
    ]),
  );
}

test("existing threads restore the persisted runtime in the URL", async ({
  page,
}) => {
  await bootstrapThreadRuntimeFixtures(page);

  await page.route("**/api/threads/thread-custom/runtime", (route) =>
    fulfillJson(route, {
      thread_id: "thread-custom",
      agent_name: "reviewer",
      agent_status: "prod",
      model_name: "kimi-k2.5",
    }),
  );
  await page.route("**/api/agents/reviewer**", (route) =>
    fulfillJson(route, {
      name: "reviewer",
      description: "Reviews contracts",
      model: null,
      tool_groups: [],
      mcp_servers: [],
      status: "prod",
      skills: [],
      agents_md: "",
    }),
  );
  await page.route("**/api/langgraph/threads/thread-custom/state**", (route) =>
    fulfillJson(route, {
      values: {
        title: "Reviewer thread",
        messages: [],
        artifacts: [],
      },
      next: [],
      metadata: {},
    }),
  );
  await page.route(
    "**/api/langgraph/threads/thread-custom/history**",
    (route) => fulfillJson(route, []),
  );
  await page.route("**/api/langgraph/threads", (route) =>
    fulfillJson(route, { thread_id: "thread-custom" }),
  );

  await page.goto("/workspace/chats/thread-custom", {
    waitUntil: "domcontentloaded",
  });

  await expect(page).toHaveURL(
    /\/workspace\/agents\/reviewer\/chats\/thread-custom\?agent_status=prod$/,
  );
});

test("thread lists build links from each thread runtime binding", async ({
  page,
}) => {
  await bootstrapThreadRuntimeFixtures(page);

  await page.goto("/workspace/chats");

  const reviewerThreadLink = page.getByRole("link", {
    name: "Reviewer thread",
  });
  await expect(reviewerThreadLink).toHaveAttribute(
    "href",
    "/workspace/agents/reviewer/chats/thread-custom?agent_status=prod",
  );

  const leadThreadLink = page.getByRole("link", {
    name: "Lead thread",
    exact: true,
  });
  await expect(leadThreadLink).toHaveAttribute(
    "href",
    "/workspace/chats/thread-lead?agent_status=dev",
  );
});

test("switching agents from an existing thread opens a new conversation", async ({
  page,
}) => {
  await bootstrapThreadRuntimeFixtures(page);

  await page.route("**/api/threads/thread-custom/runtime", (route) =>
    fulfillJson(route, {
      thread_id: "thread-custom",
      agent_name: "reviewer",
      agent_status: "prod",
      model_name: "kimi-k2.5",
    }),
  );
  await page.route("**/api/agents", (route) =>
    fulfillJson(route, {
      agents: [
        {
          name: "lead_agent",
          description: "Built-in orchestration agent",
          status: "dev",
          skills: [],
        },
        {
          name: "reviewer",
          description: "Reviews contracts",
          status: "prod",
          skills: [],
        },
      ],
    }),
  );
  await page.route("**/api/agents/reviewer**", (route) =>
    fulfillJson(route, {
      name: "reviewer",
      description: "Reviews contracts",
      model: null,
      tool_groups: [],
      mcp_servers: [],
      status: "prod",
      skills: [],
      agents_md: "",
    }),
  );
  await page.route("**/api/langgraph/threads/thread-custom/state**", (route) =>
    fulfillJson(route, {
      values: {
        title: "Reviewer thread",
        messages: [],
        artifacts: [],
      },
      next: [],
      metadata: {},
    }),
  );
  await page.route(
    "**/api/langgraph/threads/thread-custom/history**",
    (route) => fulfillJson(route, []),
  );
  await page.route("**/api/langgraph/threads", (route) =>
    fulfillJson(route, { thread_id: "thread-custom" }),
  );

  await page.goto("/workspace/chats/thread-custom", {
    waitUntil: "domcontentloaded",
  });

  await expect(page).toHaveURL(
    /\/workspace\/agents\/reviewer\/chats\/thread-custom\?agent_status=prod$/,
  );

  await page.getByRole("button", { name: /reviewer\s+prod/i }).click();
  await expect(page.getByText("Agent Workspace")).toBeVisible();
  await page.getByPlaceholder("Search agents").fill("lead_agent");
  await page.getByRole("button", { name: /lead_agent/i }).last().click();

  await expect(page).toHaveURL(/\/workspace\/chats\/new\?agent_status=dev$/);
});
