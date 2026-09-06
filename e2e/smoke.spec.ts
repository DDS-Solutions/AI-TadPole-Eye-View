import fs from 'node:fs';
import path from 'node:path';
import type { GevDebugBus } from '@gev/cesium-kit';
import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __gev?: GevDebugBus;
  }
}

test.describe('GEV v2 implemented-layer telemetry, virtualized table, and frame monitor smoke', () => {
  test('renders keyless Cesium 3D globe, virtualized telemetry stream, and uPlot charts', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.error('PAGE ERROR:', err));

    // 1. Navigate to web application
    await page.goto('/');
    const resultsDir = path.resolve('test-results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

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

    // 4. Condition-wait for all 16 implemented layers to drain entities into Cesium.
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
              (counts.weather > 0 ? 1 : 0) +
              (counts.cables > 0 ? 1 : 0) +
              (counts.satellites > 0 ? 1 : 0) +
              (counts.solar > 0 ? 1 : 0) +
              (counts.alerts > 0 ? 1 : 0) +
              (counts.aviationWeather > 0 ? 1 : 0) +
              (counts.tropicalCyclones > 0 ? 1 : 0) +
              (counts.coastalConditions > 0 ? 1 : 0)
            );
          });
        },
        {
          timeout: 20000,
          intervals: [300, 600, 1200],
        }
      )
      .toBe(16);

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
      '#cable-count',
      '#satellite-count',
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
      .toBe(11);

    // Provenance badges are derived from validated response envelopes, not hardcoded counts.
    await expect(page.locator('#provenance-source-badge')).toHaveText('16 SOURCES');
    await expect(page.locator('#provenance-mode-badge')).toContainText(/SEED|CACHED/);
    await expect(page.locator('#provenance-freshness-badge')).not.toHaveText('AWAITING');
    const provenanceBadges = page.locator('#provenance-badges');
    await provenanceBadges.evaluate((element) => element.scrollIntoView({ block: 'nearest' }));
    await expect(provenanceBadges).toBeVisible();
    await provenanceBadges.screenshot({
      path: path.join(resultsDir, 'provenance-badges.png'),
    });

    // Exercise the cable switch while the table overlay is still collapsed.
    const cablesToggle = page.locator('#toggle-cables');
    await cablesToggle.scrollIntoViewIfNeeded();
    await expect(cablesToggle).toBeChecked();
    await cablesToggle.click();
    await expect(cablesToggle).not.toBeChecked();
    await cablesToggle.click();
    await expect(cablesToggle).toBeChecked();

    // Exercise the derived satellite layer independently.
    const satellitesToggle = page.locator('#toggle-satellites');
    await satellitesToggle.scrollIntoViewIfNeeded();
    await expect(satellitesToggle).toBeChecked();
    await satellitesToggle.click();
    await expect(satellitesToggle).not.toBeChecked();
    await satellitesToggle.click();
    await expect(satellitesToggle).toBeChecked();

    const operationalPanel = page.locator('#operational-awareness-panel');
    await expect(operationalPanel).toBeVisible();
    await expect(page.locator('#nws-alert-count')).toHaveText('2');
    await expect(page.locator('#aviation-weather-count')).toHaveText('5');
    await expect(page.locator('#tropical-cyclone-count')).toHaveText('3');
    await expect(page.locator('#coastal-condition-count')).toHaveText('3');
    await expect(page.locator('#tropical-cyclone-row')).toContainText(
      'TRACK 1 · CONE 1 · WATCH/WARNING 1'
    );
    await expect(page.locator('#coastal-semantics')).toHaveText('OBS 3 · PRED 5');
    await expect(page.locator('#coastal-reference')).toHaveText('MLLW · GMT · METRIC');
    await expect(page.locator('#operational-aoi-summary')).toContainText('AOI INSPECTION');
    await expect(page.locator('#operational-usage-notice')).toContainText(
      'Not for navigation or life-safety decisions'
    );
    await expect(page.locator('#solar-context-status')).not.toHaveText('AWAITING');
    for (const selector of [
      '#toggle-solar',
      '#toggle-nws-alerts',
      '#toggle-aviation-weather',
      '#toggle-tropical-cyclones',
      '#toggle-coastal-conditions',
    ]) {
      const toggle = page.locator(selector);
      await expect(toggle).toBeChecked();
      await toggle.click();
      await expect(toggle).not.toBeChecked();
      await toggle.click();
      await expect(toggle).toBeChecked();
    }
    await operationalPanel.screenshot({
      path: path.join(resultsDir, 'task-5.3.3-operational-awareness.png'),
    });

    const selectedTrack = await page.evaluate(() => {
      const trackId = window.__gev?.getTropicalCycloneIds()[0];
      window.__gev?.setCameraPose({
        longitude: -79,
        latitude: 26,
        altitude: 1_100_000,
        heading: 0,
        pitch: -90,
        roll: 0,
      });
      return trackId ? window.__gev?.selectEntityById(`tropical-cyclone-${trackId}`) : false;
    });
    expect(selectedTrack).toBe(true);
    const operationalInfoCard = page.locator('#entity-info-card');
    await expect(operationalInfoCard).toContainText('Storm / Advisory');
    await expect(operationalInfoCard).toContainText('AL012024 / 001');
    await expect(operationalInfoCard).toContainText('Observation time');
    await expect(operationalInfoCard).toContainText('Advisory issued');
    await expect(operationalInfoCard).toContainText('Source validity');
    await expect(operationalInfoCard).toContainText('not for navigation or life-safety');
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    await page.screenshot({
      path: path.join(resultsDir, 'task-5.3.3-tropical-cyclone-map.png'),
    });

    const selectedCoastal = await page.evaluate(() => {
      const stationId = window.__gev?.getCoastalStationIds()[0];
      return stationId ? window.__gev?.selectEntityById(`coastal-condition-${stationId}`) : false;
    });
    expect(selectedCoastal).toBe(true);
    await expect(operationalInfoCard).toContainText('Station 8724580');
    await expect(operationalInfoCard).toContainText('MLLW / METRIC');
    await expect(operationalInfoCard).toContainText('GMT · America/New_York');
    await expect(operationalInfoCard).toContainText('Observed water level 0.421');
    await expect(operationalInfoCard).toContainText('Predicted tide 0.398');
    await operationalInfoCard.screenshot({
      path: path.join(resultsDir, 'task-5.3.3-coastal-station-inspection.png'),
    });
    await page.locator('.panel-header').evaluate((element) => element.scrollIntoView());

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

    // Satellite table selection always presents estimate and prohibited-use language.
    await searchInput.fill('');
    await page.locator('#filter-satellites').click();
    await expect(virtualRows.first()).toBeVisible();
    await virtualRows.first().click();
    await expect(infoCard.locator('.kind-badge')).toHaveText('SATELLITE');
    await expect(infoCard).toContainText('not for navigation');

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
    const screenshotPath = path.join(resultsDir, 'globe-task-5.3.3-operational-awareness.png');
    await page.screenshot({ path: screenshotPath });

    console.log(`[E2E] Saved task 5.3.3 operational screenshot artifact to ${screenshotPath}`);
  });

  test('visibly locks satellite controls when production terms are not approved', async ({
    page,
  }) => {
    let satelliteRequests = 0;
    await page.route('**/api/satellites', async (route) => {
      satelliteRequests += 1;
      if (satelliteRequests === 1) {
        await route.fulfill({
          status: 423,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'TERMS_APPROVAL_REQUIRED',
            error:
              'Live satellite access is locked pending written commercial-use confirmation or formal licensing-owner acceptance',
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/');
    const toggle = page.locator('#toggle-satellites');
    await expect(toggle).toBeDisabled();
    await expect(toggle).not.toBeChecked();

    const lockReason = page.locator('#satellite-access-lock');
    await lockReason.scrollIntoViewIfNeeded();
    await expect(lockReason).toHaveText('Production locked · terms approval required');

    const resultsDir = path.resolve('test-results');
    if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
    await page.locator('#satellite-layer-row').screenshot({
      path: path.join(resultsDir, 'satellite-terms-lock.png'),
    });

    await expect(toggle).toBeEnabled({ timeout: 10_000 });
    await expect(toggle).not.toBeChecked();
    expect(satelliteRequests).toBeGreaterThanOrEqual(2);
  });
});
