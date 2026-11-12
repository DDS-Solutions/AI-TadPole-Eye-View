import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

test.describe('Phase 11 Site-Risk & Accessibility HUD Inspector (Phase 11 Exit)', () => {
  test('renders site-risk tab with non-definitive disclaimer, distinct long-term hazards vs current alerts, DOT/BTS accessibility, and source attribution drawer', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await page.goto('/#/intelligence');

    const inspector = page.locator('#market-analysis-inspector');
    await expect(inspector).toBeVisible();

    const siteRiskTabBtn = page.locator('#tab-btn-site-risk');
    await expect(siteRiskTabBtn).toBeVisible();
    await siteRiskTabBtn.click();

    const content = page.locator('#site-risk-tab-content');
    await expect(content).toBeVisible();

    const disclaimer = page.locator('#site-risk-disclaimer-banner');
    await expect(disclaimer).toBeVisible();
    await expect(disclaimer).toContainText('PRELIMINARY SCREENING SIGNAL — NOT DEFINITIVE ADVICE');
    await expect(disclaimer).toContainText('NOT definitive');

    const longTermCard = page.locator('#site-risk-long-term-card');
    await expect(longTermCard).toBeVisible();
    await expect(longTermCard).toContainText('LONG_TERM_STRUCTURAL_HAZARD');

    const alertsCard = page.locator('#site-risk-current-alerts-card');
    await expect(alertsCard).toBeVisible();
    await expect(alertsCard).toContainText('CURRENT_OPERATIONAL_ALERT');

    const btsCard = page.locator('#site-risk-accessibility-card');
    await expect(btsCard).toBeVisible();
    await expect(page.locator('#metric-bts-tier')).toContainText('HIGH_ACCESS');

    const toggleBtn = page.locator('#site-risk-sources-toggle');
    await expect(toggleBtn).toBeVisible();
    await toggleBtn.click();

    const sourcesDrawer = page.locator('#site-risk-sources-drawer');
    await expect(sourcesDrawer).toBeVisible();
    await expect(sourcesDrawer).toContainText('fema-nri');
    await expect(sourcesDrawer).toContainText('usgs-3dep');
    await expect(sourcesDrawer).toContainText('epa-aqs');
    await expect(sourcesDrawer).toContainText('dot-bts-access');

    const resultsDir = path.resolve('test-results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    await page.screenshot({
      path: path.join(resultsDir, 'site-risk-inspector.png'),
      fullPage: true,
    });
  });
});
