import { expect, test } from "@playwright/test";

import { bootstrapWorkspace } from "./helpers";

test("completed subagent groups show completed copy instead of running copy", async ({
  page,
}) => {
  await bootstrapWorkspace(page);
  await page.goto("/workspace/chats/test-subagents?mock=true");

  await expect(page.getByText("Completed 2 subtasks")).toBeVisible();
  await expect(page.getByText("Executing 2 subtasks in parallel")).toHaveCount(0);
});
