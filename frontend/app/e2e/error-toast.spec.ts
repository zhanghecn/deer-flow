import { expect, test } from "@playwright/test";

import { bootstrapWorkspace } from "./helpers";

test("submit errors surface as a visible toast", async ({ page }) => {
  test.setTimeout(60_000);
  await bootstrapWorkspace(page);
  await page.route(
    "**/mock/api/threads/test-error/runs/stream**",
    async (route) => {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error: "429 Too Many Requests" }),
      });
    },
  );

  await page.goto("/workspace/chats/test-error?mock=true");

  await page
    .getByPlaceholder("How can I assist you today?")
    .fill("Trigger a mocked error");
  await page.getByRole("button", { name: "Submit" }).click();

  await expect(
    page.getByText(/429|Too Many Requests|Something went wrong/i),
  ).toBeVisible({ timeout: 45_000 });
});
