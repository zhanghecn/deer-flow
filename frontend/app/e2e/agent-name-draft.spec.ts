import { expect, test } from "@playwright/test";

import { bootstrapWorkspace } from "./helpers";

test("agent name draft survives a reload and keeps continue enabled", async ({
  page,
}) => {
  await bootstrapWorkspace(page);

  await page.goto("/workspace/agents/new", {
    waitUntil: "domcontentloaded",
  });

  const input = page.locator('input[placeholder*="code-reviewer"]').first();
  const continueButton = page.getByRole("button", { name: "Continue" });

  await input.fill("qa-agent-draft");
  await expect(continueButton).toBeEnabled();

  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(input).toHaveValue("qa-agent-draft");
  await expect(continueButton).toBeEnabled();
});
