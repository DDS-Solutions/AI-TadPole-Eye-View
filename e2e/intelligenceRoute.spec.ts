import fs from 'node:fs';
import path from 'node:path';
import type { GevDebugBus } from '@gev/cesium-kit';
import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __gev?: GevDebugBus;
  }
}

test.describe('Lazy /#/intelligence route, Cesium isolation, and navigation round-trip', () => {
  test('navigates directly to /#/intelligence with zero Cesium download or initialization', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const requestedUrls: string[] = [];

    page.on('request', (req) => {
      requestedUrls.push(req.url());
    });

    // 1. Navigate directly to /#/intelligence
    await page.goto('/#/intelligence');

    // 2. Condition-wait for the Intelligence surface to mount
    const intelView = page.locator('#intelligence-view');
    await expect(intelView).toBeVisible();

    // 3. Verify header title, badges, and navigation links
    const titleLocator = page.locator('#app-title');
    await expect(titleLocator).toHaveText('AI-Tadpole-Eye-View');

    const navIntel = page.locator('#nav-link-intelligence');
    const navGlobe = page.locator('#nav-link-globe');
    await expect(navIntel).toHaveClass(/active/);
    await expect(navGlobe).not.toHaveClass(/active/);

    // 4. Verify Cesium decoupling telemetry banner
    const cesiumMetric = page.locator('#cesium-status-metric');
    await expect(cesiumMetric).toHaveText('DECOUPLED (0 MB)');

    const webglMetric = page.locator('#webgl-context-metric');
    await expect(webglMetric).toHaveText('0 ACTIVE');

    // 5. Verify the 4 roadmap cards and PLANNED states (DESIGN.md §5.1)
    for (const phaseId of ['phase-8', 'phase-9', 'phase-10', 'phase-11']) {
      const card = page.locator(`#card-${phaseId}`);
      await expect(card).toBeVisible();
      const statusBadge = card.locator('.status-badge');
      await expect(statusBadge).toHaveText('PLANNED');
    }

    // 6. Assert Cesium was never initialized (window.__gev is undefined)
    const hasGevBus = await page.evaluate(() => typeof window.__gev !== 'undefined');
    expect(hasGevBus).toBe(false);

    // 7. Assert NO Cesium vendor script, engine, or assets were downloaded
    const cesiumRequests = requestedUrls.filter(
      (url) =>
        url.includes('vendor-cesium') ||
        url.includes('@cesium') ||
        url.includes('/cesium/Assets') ||
        url.includes('/cesium/Workers') ||
        url.includes('Cesium.js')
    );
    expect(cesiumRequests).toEqual([]);

    // 8. Capture screenshot for audit trail
    const resultsDir = path.resolve('test-results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    await page.screenshot({
      path: path.join(resultsDir, 'intelligence-route-decoupled.png'),
      fullPage: true,
    });
  });

  test('transitions smoothly from /#/intelligence to Tactical Globe (#/) and initializes Cesium', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // 1. Start at intelligence route
    await page.goto('/#/intelligence');
    await expect(page.locator('#intelligence-view')).toBeVisible();

    // 2. Click Tactical Globe link
    await page.locator('#nav-link-globe').click();

    // 3. Condition-wait for URL hash to change
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/');

    // 4. Condition-wait for Cesium globe container to mount
    await expect(page.locator('#globe-container')).toBeVisible();

    // 5. Condition-wait for window.__gev debug bus to become ready
    await expect
      .poll(async () => {
        return await page.evaluate(() => window.__gev?.isReady());
      })
      .toBe(true);

    // 6. Assert Tactical Globe navigation link is now active
    await expect(page.locator('#nav-link-globe')).toHaveClass(/active/);
    await expect(page.locator('#nav-link-intelligence')).not.toHaveClass(/active/);

    // 7. Transition back to /#/intelligence
    await page.locator('#nav-link-intelligence').click();
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/intelligence');
    await expect(page.locator('#intelligence-view')).toBeVisible();
    await expect(page.locator('#nav-link-intelligence')).toHaveClass(/active/);
  });

  test('reloads directly on /#/intelligence and /#/ preserving route state and Cesium decoupling', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const requestedUrls: string[] = [];

    page.on('request', (req) => {
      requestedUrls.push(req.url());
    });

    // 1. Direct navigation to /#/intelligence
    await page.goto('/#/intelligence');
    await expect(page.locator('#intelligence-view')).toBeVisible();
    await expect(page.locator('#nav-link-intelligence')).toHaveClass(/active/);

    // 2. Direct page reload at /#/intelligence
    await page.reload();
    await expect(page.locator('#intelligence-view')).toBeVisible();
    await expect(page.locator('#nav-link-intelligence')).toHaveClass(/active/);

    // 3. Confirm Cesium remains unloaded after reload
    const hasGevBus = await page.evaluate(() => typeof window.__gev !== 'undefined');
    expect(hasGevBus).toBe(false);
    const cesiumRequests = requestedUrls.filter(
      (url) =>
        url.includes('vendor-cesium') ||
        url.includes('@cesium') ||
        url.includes('/cesium/Assets') ||
        url.includes('/cesium/Workers') ||
        url.includes('Cesium.js')
    );
    expect(cesiumRequests).toEqual([]);

    // 4. Navigate to globe route and reload
    await page.locator('#nav-link-globe').click();
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/');
    await expect(page.locator('#globe-container')).toBeVisible();
    await expect.poll(async () => page.evaluate(() => window.__gev?.isReady())).toBe(true);

    // 5. Direct page reload at #/
    await page.reload();
    await expect(page.locator('#globe-container')).toBeVisible();
    await expect.poll(async () => page.evaluate(() => window.__gev?.isReady())).toBe(true);
    await expect(page.locator('#nav-link-globe')).toHaveClass(/active/);
  });
});
