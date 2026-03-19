import { expect, test } from "@playwright/test";

import { bootstrapWorkspace } from "./helpers";

test("mode selector only shows flash and pro", async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.goto("/workspace/chats/new?mock=true");

  await page.getByRole("button", { name: "Pro" }).click();

  await expect(
    page.getByRole("menuitem").filter({ hasText: "Flash" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("menuitem").filter({ hasText: "Pro" }),
  ).toHaveCount(1);
  await expect(page.getByRole("menuitem")).toHaveCount(2);
  await expect(
    page.getByRole("menuitem").filter({ hasText: "Ultra" }),
  ).toHaveCount(0);
});
