import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

test.describe('GEV v2 Keyless Globe & Flight Feed Smoke', () => {
  test('renders keyless Cesium 3D globe and streams fixture flights', async ({ page }) => {
    // 1. Navigate to web application
    await page.goto('/');

    // 2. Assert basic shell elements and attribution
    const titleLocator = page.locator('#app-title');
    await expect(titleLocator).toHaveText("GEV v2 — God's Eye View");

    const attributionLocator = page.locator('#osm-attribution');
    await expect(attributionLocator).toBeVisible();

    // 3. Condition-wait for window.__gev debug bus readiness
    await expect
      .poll(async () => {
        return await page.evaluate(() => window.__gev?.isReady());
      })
      .toBe(true);

    // 4. Condition-wait for flight entities to drain into Cesium (Rule 5 & Rule 2)
    await expect
      .poll(
        async () => {
          return await page.evaluate(() => window.__gev?.getEntityCount() ?? 0);
        },
        {
          timeout: 15000,
          intervals: [200, 500, 1000],
        }
      )
      .toBeGreaterThanOrEqual(1);

    // 5. Assert HUD status text shows connected
    const statusLocator = page.locator('#app-status');
    await expect(statusLocator).toContainText('Connected');

    // 6. Ensure artifact directory exists and capture screenshot (Rule 2: visual evidence)
    const resultsDir = path.resolve('test-results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    const screenshotPath = path.join(resultsDir, 'globe-flights.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log(`[E2E] Saved globe screenshot artifact to ${screenshotPath}`);
  });
});
