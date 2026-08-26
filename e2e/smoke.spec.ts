import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

test.describe('GEV v2 Multi-Layer Telemetry & Tactical HUD Smoke (PLAN.md Phase 2)', () => {
  test('renders keyless Cesium 3D globe and streams all 9 Layers with tactical HUD controls', async ({
    page,
  }) => {
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

    // 4. Condition-wait for all 9 layers to drain entities into Cesium (Rule 5 & Rule 2)
    await expect
      .poll(
        async () => {
          return await page.evaluate(() => {
            const counts = window.__gev?.getLayerCounts();
            if (!counts) return 0;
            return (
              (counts.flights > 0 ? 1 : 0) +
              (counts.marine > 0 ? 1 : 0) +
              (counts.quakes > 0 ? 1 : 0) +
              (counts.firms > 0 ? 1 : 0) +
              (counts.gbfs > 0 ? 1 : 0) +
              (counts.cctv > 0 ? 1 : 0) +
              (counts.radio > 0 ? 1 : 0) +
              (counts.launches > 0 ? 1 : 0) +
              (counts.weather > 0 ? 1 : 0)
            );
          });
        },
        {
          timeout: 20000,
          intervals: [300, 600, 1200],
        }
      )
      .toBe(9);

    // 5. Assert HUD stat badge counts in the header
    await expect(page.locator('#flight-count')).not.toHaveText('0');
    await expect(page.locator('#ship-count')).not.toHaveText('0');
    await expect(page.locator('#quake-count')).not.toHaveText('0');
    await expect(page.locator('#firms-count')).not.toHaveText('0');
    await expect(page.locator('#gbfs-count')).not.toHaveText('0');
    await expect(page.locator('#cctv-count')).not.toHaveText('0');
    await expect(page.locator('#radio-count')).not.toHaveText('0');
    await expect(page.locator('#launch-count')).not.toHaveText('0');
    await expect(page.locator('#weather-count')).not.toHaveText('0');

    // 6. Test Layer Control Panel toggles
    const flightsToggle = page.locator('#toggle-flights');
    await expect(flightsToggle).toBeChecked();
    await flightsToggle.setChecked(false, { force: true });
    await expect(flightsToggle).not.toBeChecked();
    await flightsToggle.setChecked(true, { force: true });
    await expect(flightsToggle).toBeChecked();

    const cctvToggle = page.locator('#toggle-cctv');
    await expect(cctvToggle).toBeChecked();

    const radioToggle = page.locator('#toggle-radio');
    await expect(radioToggle).toBeChecked();

    const launchToggle = page.locator('#toggle-launches');
    await expect(launchToggle).toBeChecked();

    // 7. Test Filter tabs and interaction
    const filtersTabBtn = page.getByRole('button', { name: 'Filters' });
    await filtersTabBtn.click();

    const m45FilterBtn = page.locator('#filter-quakes-m45');
    await expect(m45FilterBtn).toBeVisible();
    await m45FilterBtn.click();
    await expect(m45FilterBtn).toHaveClass(/active/);

    const frp50FilterBtn = page.locator('#filter-firms-frp50');
    await expect(frp50FilterBtn).toBeVisible();
    await frp50FilterBtn.click();
    await expect(frp50FilterBtn).toHaveClass(/active/);

    const cctvCaltransFilterBtn = page.locator('#filter-cctv-caltrans');
    await expect(cctvCaltransFilterBtn).toBeVisible();
    await cctvCaltransFilterBtn.click();
    await expect(cctvCaltransFilterBtn).toHaveClass(/active/);

    // 8. Test collapse / expand panel
    const collapseBtn = page.locator('#toggle-collapse-btn');
    await collapseBtn.click();
    await expect(collapseBtn).toHaveText('◀');
    await collapseBtn.click();
    await expect(collapseBtn).toHaveText('▼');

    // 9. Ensure artifact directory exists and capture screenshot (Rule 2: visual evidence)
    const resultsDir = path.resolve('test-results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    const screenshotPath = path.join(resultsDir, 'globe-all-9-layers.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log(`[E2E] Saved 9-layer globe screenshot artifact to ${screenshotPath}`);
  });
});
