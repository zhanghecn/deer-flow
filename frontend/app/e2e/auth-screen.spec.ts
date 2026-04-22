import { expect, test, type Page, type Route } from "@playwright/test";

async function fulfillJson(route: Route, json: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(json),
  });
}

async function bootstrapAuthScreen(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "openagents.local-settings",
      JSON.stringify({
        notification: { enabled: false },
        context: {
          model_name: "kimi-k2.5",
          mode: "pro",
          effort: "high",
          agent_status: "dev",
        },
        layout: { sidebar_collapsed: false },
      }),
    );
    document.cookie = "locale=en-US; path=/";
  });

  await page.route("**/api/models", (route) =>
    fulfillJson(route, {
      models: [
        {
          id: "kimi-k2.5",
          name: "kimi-k2.5",
          display_name: "Kimi K2.5",
          supports_thinking: true,
          supports_effort: true,
        },
      ],
    }),
  );
  await page.route("**/api/skills", (route) =>
    fulfillJson(route, {
      skills: [
        {
          name: "frontend-design",
          description: "Build polished UI quickly.",
          category: "design/ui",
          license: "MIT",
          enabled: true,
        },
      ],
    }),
  );
  await page.route("**/api/threads/search", (route) => fulfillJson(route, []));
  await page.route("**/api/agents**", (route) =>
    fulfillJson(route, { agents: [] }),
  );
  await page.route("**/api/mcp/config", (route) =>
    fulfillJson(route, { mcp_servers: {} }),
  );
}

test("auth screen switches to register immediately after initial load", async ({
  page,
}) => {
  await bootstrapAuthScreen(page);
  await page.goto("/login", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Create an account" }).click();

  await expect(page.getByLabel("Name")).toBeVisible();
  await expect(page.getByLabel("Confirm password")).toBeVisible();
});

test("login redirects to workspace when auth succeeds", async ({ page }) => {
  await bootstrapAuthScreen(page);
  await page.route("**/api/auth/login", (route) =>
    fulfillJson(route, {
      token: "pw-auth-token",
      user: {
        id: "pw-user",
        email: "pw@example.com",
        name: "Playwright User",
        role: "admin",
      },
    }),
  );

  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.fill("#login-account", "admin");
  await page.fill("#login-password", "admin123");
  await page.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(/\/workspace\/chats\/new$/);
});
