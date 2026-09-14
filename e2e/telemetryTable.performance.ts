import type { GevDebugBus } from '@gev/cesium-kit';
import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __gev?: GevDebugBus;
  }
}

test('keeps fixed-row telemetry windowing below the 60 FPS frame budget', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.__gev?.isReady())).toBe(true);

  await page.locator('#toggle-telemetry-table-btn').click();
  const viewport = page.getByRole('region', { name: 'Telemetry rows' });
  const rows = page.getByRole('button', { name: /^Focus / });
  await expect(rows.first()).toBeVisible();
  const totalItems = Number(
    ((await page.getByTestId('telemetry-count').textContent()) ?? '').replace(/\D/g, '')
  );
  expect(totalItems).toBeGreaterThan(1_000);
  const rowLimit = await viewport.evaluate((element) => Math.ceil(element.clientHeight / 36) + 13);

  const scrollProfile = await viewport.evaluate(async (element) => {
    const durations: number[] = [];
    let maximumRows = 0;
    const maximumScroll = element.scrollHeight - element.clientHeight;
    const scrollStep = 36 * 3;

    for (let index = 1; index <= 48; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const startedAt = performance.now();
      element.scrollTop = Math.min(maximumScroll, scrollStep * index);
      element.dispatchEvent(new Event('scroll'));
      await Promise.resolve();
      document.querySelector<HTMLElement>('.virtual-row')?.getBoundingClientRect();
      durations.push(performance.now() - startedAt);
      maximumRows = Math.max(maximumRows, document.querySelectorAll('.virtual-row').length);
    }

    durations.sort((left, right) => left - right);
    return {
      maximumRows,
      p95Ms: durations[Math.floor(durations.length * 0.95)] ?? Number.POSITIVE_INFINITY,
    };
  });

  console.log(
    `[Benchmark Telemetry Windowing] Entities=${totalItems} | max DOM rows=${scrollProfile.maximumRows}/${rowLimit} | scroll work p95=${scrollProfile.p95Ms.toFixed(2)}ms`
  );
  expect(scrollProfile.maximumRows).toBeLessThanOrEqual(rowLimit);
  expect(scrollProfile.p95Ms).toBeLessThan(16.6);
  expect(pageErrors).toEqual([]);
});
