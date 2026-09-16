import { type Page, expect, test } from '@playwright/test';

async function openTelemetryTable(page: Page) {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.__gev?.isReady())).toBe(true);

  const toggle = page.locator('#toggle-telemetry-table-btn');
  await expect(toggle).toBeVisible();
  await toggle.click();

  const panel = page.getByRole('region', { name: 'High-Density Telemetry Stream' });
  const viewport = page.getByRole('region', { name: 'Telemetry rows' });
  const rows = panel.getByRole('button', { name: /^Focus / });
  await expect(panel).toBeVisible();
  await expect(rows.first()).toBeVisible();

  return { panel, rows, toggle, viewport };
}

test('resets intentional navigation, keeps rows bounded, and supports keyboard operation', async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  const pageErrors: Error[] = [];
  let flightRequests = 0;
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.route('**/api/flights', async (route) => {
    flightRequests += 1;
    await route.continue();
  });

  const { panel, rows, toggle, viewport } = await openTelemetryTable(page);
  await expect
    .poll(async () => {
      const text = (await page.getByTestId('telemetry-count').textContent()) ?? '';
      return Number(text.replace(/\D/g, ''));
    })
    .toBeGreaterThan(1_000);
  const totalItems = Number(
    ((await page.getByTestId('telemetry-count').textContent()) ?? '').replace(/\D/g, '')
  );

  const rowLimit = await viewport.evaluate((element) => Math.ceil(element.clientHeight / 36) + 13);
  await expect.poll(() => rows.count()).toBeLessThanOrEqual(rowLimit);
  expect(await rows.count()).toBeLessThan(totalItems);

  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect
    .poll(async () => Number((await rows.first().getAttribute('data-virtual-index')) ?? '0'))
    .toBeGreaterThan(0);

  const flightFilter = page.getByRole('button', { name: 'Show ADS-B telemetry' });
  await flightFilter.focus();
  await flightFilter.press('Space');
  await expect(flightFilter).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(rows.first()).toHaveAttribute('data-virtual-index', '0');
  await expect(rows.first()).toHaveAttribute('data-entity-kind', 'flight');

  await viewport.evaluate((element) => {
    element.scrollTop = 36 * 120;
    element.dispatchEvent(new Event('scroll'));
  });
  const readingPosition = await expect
    .poll(() => viewport.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0)
    .then(() => viewport.evaluate((element) => element.scrollTop));
  const requestCountBeforeRefresh = flightRequests;
  await expect
    .poll(() => flightRequests, {
      timeout: 15_000,
      intervals: [500, 1_000, 2_000],
    })
    .toBeGreaterThan(requestCountBeforeRefresh);
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(readingPosition);

  const keyboardRow = rows.nth(6);
  const keyboardRowKind = await keyboardRow.getAttribute('data-entity-kind');
  const keyboardRowId = await keyboardRow.getAttribute('data-entity-id');
  expect(keyboardRowKind).not.toBeNull();
  expect(keyboardRowId).not.toBeNull();
  await keyboardRow.focus();
  await keyboardRow.press('Space');
  await expect(
    panel.locator(
      `.virtual-row[data-entity-kind="${keyboardRowKind}"][data-entity-id="${keyboardRowId}"]`
    )
  ).toHaveClass(/selected/);
  await expect(page.locator('#entity-info-card')).toBeVisible();

  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const visibleName = (await rows.first().locator('.col-id').textContent())?.trim() ?? '';
  expect(visibleName).not.toBe('');

  const search = page.getByRole('textbox', { name: 'Search telemetry' });
  await search.fill(visibleName);
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(0);
  await page.getByRole('button', { name: 'Clear telemetry search' }).click();
  await expect(search).toHaveValue('');
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(0);

  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const close = page.getByRole('button', { name: 'Close telemetry table' });
  await close.focus();
  await close.press('Enter');
  await expect(panel).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.press('Enter');
  await expect(panel).toBeVisible();
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(rows.first()).toHaveAttribute('data-virtual-index', '0');

  await panel.screenshot({ path: testInfo.outputPath('telemetry-table-desktop.png') });
  expect(pageErrors).toEqual([]);
});

test('keeps the telemetry controls and compact columns in-frame at 360x640', async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const viewportSize = { width: 360, height: 640 };
  await page.setViewportSize(viewportSize);
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  const { panel, rows, viewport } = await openTelemetryTable(page);
  await expect(page.getByRole('group', { name: 'Telemetry channel filters' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Search telemetry' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close telemetry table' })).toBeVisible();
  await expect(rows.first()).toHaveAccessibleName(/^Focus /);

  const panelBox = await panel.boundingBox();
  expect(panelBox).not.toBeNull();
  expect(panelBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect(panelBox?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((panelBox?.x ?? viewportSize.width) + (panelBox?.width ?? 1)).toBeLessThanOrEqual(
    viewportSize.width
  );
  expect((panelBox?.y ?? viewportSize.height) + (panelBox?.height ?? 1)).toBeLessThanOrEqual(
    viewportSize.height
  );
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  await expect(panel.locator('.columns-header .col-metric2')).toBeHidden();
  await expect(panel.locator('.columns-header .col-coords')).toBeHidden();
  await expect(panel.locator('.columns-header .col-time')).toBeHidden();
  const rowLimit = await viewport.evaluate((element) => Math.ceil(element.clientHeight / 36) + 13);
  await expect.poll(() => rows.count()).toBeLessThanOrEqual(rowLimit);

  await panel.screenshot({ path: testInfo.outputPath('telemetry-table-mobile.png') });
  expect(pageErrors).toEqual([]);
});
