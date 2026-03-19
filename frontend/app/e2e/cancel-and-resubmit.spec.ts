import { expect, test } from "@playwright/test";

import { bootstrapWorkspace } from "./helpers";

test("history fixtures keep earlier messages visible after a follow-up turn", async ({
  page,
}) => {
  await bootstrapWorkspace(page);
  await page.goto("/workspace/chats/test-cancel?mock=true", {
    waitUntil: "domcontentloaded",
  });

  await expect(page.getByText("Initial draft request")).toBeVisible();
  await expect(page.getByText("Here is the first draft.")).toBeVisible();
  await expect(page.getByText("Please revise the second paragraph.")).toBeVisible();
  await expect(page.getByText("Updated the second paragraph.")).toBeVisible();
});
