import { test } from '@playwright/test';
import { bootstrapWorkspace } from './helpers';

test('screenshot agents page review', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.route('**/api/agents', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        agents: [
          { name: 'reviewer', description: 'Review contracts and call out risks before merge.', model: null, tool_groups: null, status: 'dev', can_manage: true },
          { name: 'reviewer', description: 'Review contracts and call out risks before merge.', model: null, tool_groups: null, status: 'prod', can_manage: true },
          { name: 'researcher', description: 'Collect source-backed technical notes and summarize tradeoffs.', model: null, tool_groups: null, status: 'prod', can_manage: false },
          { name: 'writer', description: 'Draft migration notes and operator-facing documentation.', model: null, tool_groups: null, status: 'dev', can_manage: true },
        ],
      }),
    });
  });
  await page.goto('/workspace/agents');
  await page.screenshot({ path: '/tmp/oa-agents-review.png', fullPage: true });
});
