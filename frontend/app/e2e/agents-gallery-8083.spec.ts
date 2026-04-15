import { expect, test } from "@playwright/test";

import { bootstrapWorkspace } from "./helpers";

test("agents gallery shows refreshed management layout on 8083", async ({
  page,
}) => {
  await bootstrapWorkspace(page);

  await page.route("**/api/agents", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agents: [
          {
            name: "reviewer",
            description: "Review contracts",
            model: null,
            tool_groups: null,
            status: "dev",
            can_manage: true,
          },
          {
            name: "reviewer",
            description: "Review contracts",
            model: null,
            tool_groups: null,
            status: "prod",
            can_manage: true,
          },
        ],
      }),
    });
  });

  await page.goto("/workspace/agents");

  await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();
  await expect(
    page.getByText(
      "Create and manage custom agents with specialized prompts and capabilities.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Draft default").first()).toBeVisible();
  await expect(page.getByText("Published ready").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start chatting" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Publish to prod" }).first(),
  ).toBeVisible();
});
