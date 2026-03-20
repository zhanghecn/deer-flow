import { expect, test, type Page, type Route } from "@playwright/test";

import { bootstrapWorkspace } from "./helpers";

async function fulfillJson(route: Route, json: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(json),
  });
}

async function bootstrapClearAllFixtures(page: Page) {
  await bootstrapWorkspace(page);

  await page.route("**/api/threads/search", (route) =>
    fulfillJson(route, [
      {
        thread_id: "thread-custom",
        updated_at: "2026-03-20T00:00:00.000Z",
        values: { title: "Reviewer thread" },
        agent_name: "reviewer",
        agent_status: "prod",
      },
    ]),
  );
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
}

test("clear all chats deletes the current user's threads and opens a new chat", async ({
  page,
}) => {
  await bootstrapClearAllFixtures(page);

  let clearAllCalled = false;
  await page.route("**/api/threads", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.fallback();
      return;
    }
    clearAllCalled = true;
    await fulfillJson(route, { deleted_count: 1 });
  });

  await page.goto("/workspace/chats/thread-custom", {
    waitUntil: "domcontentloaded",
  });

  await expect(page).toHaveURL(
    /\/workspace\/agents\/reviewer\/chats\/thread-custom\?agent_status=prod$/,
  );

  await page.getByRole("button", { name: "Clear all chats" }).click();
  await expect(
    page.getByText(
      "Are you sure you want to delete all of your chats? This action cannot be undone.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear all" }).click();

  await expect.poll(() => clearAllCalled).toBeTruthy();
  await expect(page).toHaveURL(
    /\/workspace\/agents\/reviewer\/chats\/new\?agent_status=prod$/,
  );
});
