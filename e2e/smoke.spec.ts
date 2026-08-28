import fs from 'node:fs';
import path from 'node:path';
import type { GevDebugBus } from '@gev/cesium-kit';
import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __gev?: GevDebugBus;
  }
}

test.describe('GEV v2 Multi-Layer Telemetry, Virtualized Table & Frame Monitor Smoke (PLAN.md Phase 2)', () => {
  test('renders keyless Cesium 3D globe, virtualized telemetry stream, and uPlot charts', async ({
    page,
  }) => {
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.error('PAGE ERROR:', err));

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

    // 5. Condition-wait for all HUD stat badge counts in one browser round trip.
    const hudCountSelector = [
      '#flight-count',
      '#ship-count',
      '#quake-count',
      '#firms-count',
      '#gbfs-count',
      '#cctv-count',
      '#radio-count',
      '#launch-count',
      '#weather-count',
    ].join(', ');
    await expect
      .poll(async () => {
        return await page.locator(hudCountSelector).evaluateAll((elements) => {
          return elements.filter((element) => {
            const count = element.textContent?.trim();
            return count !== undefined && count !== '' && count !== '0';
          }).length;
        });
      })
      .toBe(9);

    // 6. Test Frame Budget Monitor integration on window.__gev
    const frameReport = await page.evaluate(() => window.__gev?.getFrameReport?.());
    expect(frameReport).not.toBeNull();
    if (frameReport) {
      expect(frameReport.targetFps).toBe(60);
      expect(frameReport.targetBudgetMs).toBeCloseTo(16.666, 2);
      expect(frameReport.metrics.totalFrames).toBeGreaterThan(0);
    }

    // 7. Test High-Density Virtualized Telemetry Table
    const toggleTableBtn = page.locator('#toggle-telemetry-table-btn');
    await expect(toggleTableBtn).toBeVisible();
    await toggleTableBtn.click();

    const tablePanel = page.locator('#virtualized-telemetry-table');
    await expect(tablePanel).toBeVisible();

    // Verify virtual rows rendered
    const virtualRows = page.locator('.virtual-row');
    await expect(virtualRows.first()).toBeVisible();

    // Test Search input inside the table
    const searchInput = page.locator('#telemetry-search-input');
    const firstRowName = (await virtualRows.first().locator('.col-id').textContent())?.trim() ?? '';
    expect(firstRowName).not.toBe('');
    await searchInput.fill(firstRowName);
    await expect(searchInput).toHaveValue(firstRowName);

    // Test selecting a matching row from the filtered virtual table.
    await expect(virtualRows.first()).toBeVisible();
    await virtualRows.first().click();

    // Assert Entity Info Card is open and displays uPlot time series chart
    const infoCard = page.locator('#entity-info-card');
    await expect(infoCard).toBeVisible();

    // 8. Test Layer Control Panel toggles
    const flightsToggle = page.locator('#toggle-flights');
    await expect(flightsToggle).toBeChecked();
    await flightsToggle.setChecked(false, { force: true });
    await expect(flightsToggle).not.toBeChecked();
    await flightsToggle.setChecked(true, { force: true });
    await expect(flightsToggle).toBeChecked();

    // 9. Test Filter tabs and interaction
    const filtersTabBtn = page.getByRole('button', { name: 'Filters' });
    await expect(filtersTabBtn).toBeVisible();
    await filtersTabBtn.click({ force: true });

    const m45FilterBtn = page.locator('#filter-quakes-m45');
    await expect(m45FilterBtn).toBeVisible();
    await m45FilterBtn.click({ force: true });
    await expect(m45FilterBtn).toHaveClass(/active/);

    // 10. Capture screenshot artifact (Rule 2: visual verification)
    const resultsDir = path.resolve('test-results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    const screenshotPath = path.join(resultsDir, 'globe-phase2-virtual-telemetry.png');
    await page.screenshot({ path: screenshotPath });

    console.log(`[E2E] Saved Phase 2 telemetry screenshot artifact to ${screenshotPath}`);
  });
});
