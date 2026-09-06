import fs from 'node:fs';
import path from 'node:path';
import { type Page, expect, test } from '@playwright/test';

async function waitForOperationalPanelPaint(page: Page): Promise<void> {
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const panel = document.querySelector('#operational-awareness-panel');
        if (!(panel instanceof HTMLElement)) return false;
        const bounds = panel.getBoundingClientRect();
        return (
          document.fonts.status === 'loaded' &&
          bounds.width >= 340 &&
          bounds.height >= 300 &&
          getComputedStyle(panel).visibility === 'visible'
        );
      })
    )
    .toBe(true);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
}

const SCREENSHOT_STYLE = `
  #operational-awareness-panel {
    backdrop-filter: none !important;
    background: var(--hud-panel-bg-strong) !important;
  }
`;

test('shows bounded empty, stale, unavailable, expired, and recovered operational states', async ({
  page,
}) => {
  test.setTimeout(180_000);
  type VisualState = 'empty' | 'stale' | 'expired' | 'unavailable' | 'recovered';
  let visualState: VisualState = 'empty';
  const resultsDir = path.resolve('test-results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

  await page.route('**/api/operational/alerts?**', async (route) => {
    if (visualState === 'unavailable') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'SOURCE_UNAVAILABLE', error: 'Synthetic source outage' }),
      });
      return;
    }
    const upstream = await route.fetch();
    const body = (await upstream.json()) as Record<string, unknown>;
    if (visualState === 'empty') {
      body.count = 0;
      body.alerts = [];
    } else if (visualState === 'stale') {
      (body.provenance as { freshness: Record<string, unknown> }).freshness = {
        status: 'stale',
        age_seconds: 120,
        fresh_for_seconds: 30,
      };
    }
    await route.fulfill({ response: upstream, json: body });
  });
  await page.route('**/api/operational/aviation?**', async (route) => {
    if (visualState === 'unavailable') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'SOURCE_UNAVAILABLE', error: 'Synthetic source outage' }),
      });
      return;
    }
    const upstream = await route.fetch();
    const body = (await upstream.json()) as Record<string, unknown>;
    if (visualState === 'empty') {
      for (const key of ['metars', 'tafs', 'sigmets']) {
        const product = body[key] as { count: number; items: unknown[] };
        product.count = 0;
        product.items = [];
      }
    } else if (visualState === 'stale') {
      (body.provenance as { freshness: Record<string, unknown> }).freshness = {
        status: 'stale',
        age_seconds: 120,
        fresh_for_seconds: 60,
      };
    }
    await route.fulfill({ response: upstream, json: body });
  });
  await page.route('**/api/operational/tropical-cyclones?**', async (route) => {
    if (visualState === 'unavailable') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'SOURCE_UNAVAILABLE', error: 'Synthetic source outage' }),
      });
      return;
    }
    const upstream = await route.fetch();
    const body = (await upstream.json()) as Record<string, unknown>;
    if (visualState === 'empty' || visualState === 'expired') {
      body.count = 0;
      body.advisories = [];
    } else if (visualState === 'stale') {
      (body.provenance as { freshness: Record<string, unknown> }).freshness = {
        status: 'stale',
        age_seconds: 600,
        fresh_for_seconds: 300,
      };
    }
    await route.fulfill({ response: upstream, json: body });
  });
  await page.route('**/api/operational/coastal?**', async (route) => {
    if (visualState === 'unavailable') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'SOURCE_UNAVAILABLE', error: 'Synthetic source outage' }),
      });
      return;
    }
    const upstream = await route.fetch();
    const body = (await upstream.json()) as Record<string, unknown>;
    if (visualState === 'empty' || visualState === 'expired') {
      body.count = 0;
      body.record_count = 0;
      body.stations = [];
    } else if (visualState === 'stale') {
      (body.provenance as { freshness: Record<string, unknown> }).freshness = {
        status: 'stale',
        age_seconds: 720,
        fresh_for_seconds: 360,
      };
    }
    await route.fulfill({ response: upstream, json: body });
  });

  await page.goto('/');
  await expect(page.locator('#nws-alert-status')).toHaveText('NO EVENTS IN AOI');
  await expect(page.locator('#aviation-weather-status')).toHaveText('NO EVENTS IN AOI');
  await expect(page.locator('#tropical-cyclone-status')).toHaveText('NO EVENTS IN AOI');
  await expect(page.locator('#coastal-condition-status')).toHaveText('NO STATIONS IN AOI');
  await waitForOperationalPanelPaint(page);
  await page
    .locator('#operational-awareness-panel')
    .screenshot({ path: path.join(resultsDir, 'task-5.3.3-empty.png'), style: SCREENSHOT_STYLE });

  visualState = 'stale';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#nws-alert-status')).toContainText('STALE');
  await expect(page.locator('#tropical-cyclone-status')).toContainText('STALE');
  await expect(page.locator('#coastal-condition-status')).toContainText('STALE');
  await waitForOperationalPanelPaint(page);
  await page
    .locator('#operational-awareness-panel')
    .screenshot({ path: path.join(resultsDir, 'task-5.3.3-stale.png'), style: SCREENSHOT_STYLE });

  visualState = 'expired';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#tropical-cyclone-status')).toHaveText('NO EVENTS IN AOI');
  await expect(page.locator('#coastal-condition-status')).toHaveText('NO STATIONS IN AOI');
  await waitForOperationalPanelPaint(page);
  await page
    .locator('#operational-awareness-panel')
    .screenshot({ path: path.join(resultsDir, 'task-5.3.3-expired.png'), style: SCREENSHOT_STYLE });

  visualState = 'unavailable';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#nws-alert-status')).toHaveText('SOURCE UNAVAILABLE');
  await expect(page.locator('#aviation-weather-status')).toHaveText('SOURCE UNAVAILABLE');
  await expect(page.locator('#tropical-cyclone-status')).toHaveText('SOURCE UNAVAILABLE');
  await expect(page.locator('#coastal-condition-status')).toHaveText('SOURCE UNAVAILABLE');
  await waitForOperationalPanelPaint(page);
  await page.locator('#operational-awareness-panel').screenshot({
    path: path.join(resultsDir, 'task-5.3.3-unavailable.png'),
    style: SCREENSHOT_STYLE,
  });

  visualState = 'recovered';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#nws-alert-count')).toHaveText('2');
  await expect(page.locator('#aviation-weather-count')).toHaveText('5');
  await expect(page.locator('#tropical-cyclone-count')).toHaveText('3');
  await expect(page.locator('#coastal-condition-count')).toHaveText('3');
  await expect(page.locator('#nws-alert-status')).not.toHaveText('SOURCE UNAVAILABLE');
  await waitForOperationalPanelPaint(page);
  await page.locator('#operational-awareness-panel').screenshot({
    path: path.join(resultsDir, 'task-5.3.3-recovered.png'),
    style: SCREENSHOT_STYLE,
  });
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
