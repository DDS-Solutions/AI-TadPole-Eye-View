import { expect, test } from '@playwright/test';

test.describe('GEV v2 Smoke Test', () => {
  test('scaffold placeholder page renders cleanly', async ({ page }) => {
    await page.goto('/');

    const titleLocator = page.locator('#app-title');
    await expect(titleLocator).toBeVisible();
    await expect(titleLocator).toHaveText("GEV v2 — God's Eye View");

    const statusLocator = page.locator('#app-status');
    await expect(statusLocator).toBeVisible();
    await expect(statusLocator).toHaveText('SCAFFOLD READY');
  });
});
