import { expect, test } from "@playwright/test";

import { bootstrapWorkspace } from "./helpers";

test("skill picker supports keyboard selection", async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.goto("/workspace/chats/new?mock=true");

  const textarea = page.getByPlaceholder("How can I assist you today?");
  await textarea.fill("$f");

  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  await expect(textarea).toHaveValue("$frontend-design ");
});
