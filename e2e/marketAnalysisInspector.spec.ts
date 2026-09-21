import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

test.describe('Market Analysis HUD Inspector & Multi-Source Evidence (Task 9.5)', () => {
  test('renders market context, demographics, business activity, commercial footprint, disagreement state, and evidence drawer', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
    page.on('requestfailed', (req) =>
      console.error('REQ FAILED:', req.url(), req.failure()?.errorText)
    );
    page.on('response', (res) => {
      if (res.url().includes('/api/economic/')) {
        console.log('ECONOMIC RES:', res.url(), res.status());
      }
    });

    // 1. Navigate to Intelligence route
    await page.goto('/#/intelligence');

    // 2. Condition-wait for Intelligence view and Market Inspector to mount
    const inspector = page.locator('#market-analysis-inspector');
    await expect(inspector).toBeVisible();

    const title = page.locator('#market-inspector-title');
    await expect(title).toHaveText('Market & Business Footprint Inspector');

    // 3. Verify presets and interactive controls
    const geoSelect = page.locator('#market-inspector-geo-select');
    await expect(geoSelect).toBeVisible();
    await expect(geoSelect).toHaveValue('travis-county');

    const naicsSelect = page.locator('#market-inspector-naics-select');
    await expect(naicsSelect).toBeVisible();
    await expect(naicsSelect).toHaveValue('722511');

    const runBtn = page.locator('#market-inspector-run-btn');
    await expect(runBtn).toBeVisible();

    // 4. Condition-wait for Demographics card and non-coerced estimates
    const demoCard = page.locator('#market-demographics-card');
    await expect(demoCard).toBeVisible();

    const popMetric = page.locator('#metric-total-population');
    await expect(popMetric).toBeVisible();
    await expect(popMetric).not.toHaveText('$0');
    await expect(popMetric).not.toHaveText('0');

    const incomeMetric = page.locator('#metric-median-income');
    await expect(incomeMetric).toBeVisible();
    await expect(incomeMetric).not.toHaveText('$0');

    const foreignBornMetric = page.locator('#metric-foreign-born');
    await expect(foreignBornMetric).toBeVisible();

    // 5. Condition-wait for Business Activity card and non-coerced estimates
    const bizCard = page.locator('#market-business-card');
    await expect(bizCard).toBeVisible();

    const estMetric = page.locator('#metric-total-establishments');
    await expect(estMetric).toBeVisible();

    const empMetric = page.locator('#metric-paid-employment');
    await expect(empMetric).toBeVisible();

    const payrollMetric = page.locator('#metric-annual-payroll');
    await expect(payrollMetric).toBeVisible();

    const wageMetric = page.locator('#metric-average-wage');
    await expect(wageMetric).toBeVisible();

    // 6. Verify Commercial Footprint and mandatory ODbL attribution notice
    const commCard = page.locator('#market-commercial-card');
    await expect(commCard).toBeVisible();

    const poisMetric = page.locator('#metric-total-pois');
    await expect(poisMetric).toBeVisible();

    const densityMetric = page.locator('#metric-poi-density');
    await expect(densityMetric).toBeVisible();

    const osmAttr = page.locator('#osm-poi-attribution');
    await expect(osmAttr).toBeVisible();
    await expect(osmAttr).toContainText('© OpenStreetMap contributors (ODbL 1.0)');

    // 7. Verify source-linked disagreement banner
    const disagreementBanner = page.locator('#market-inspector-disagreement-banner');
    await expect(disagreementBanner).toBeVisible();
    await expect(disagreementBanner).toContainText('UNRESOLVED_PRESERVED');

    // 8. Test Evidence Inspection Drawer toggle
    const evidenceToggle = page.locator('#market-inspector-evidence-toggle');
    await expect(evidenceToggle).toBeVisible();
    await evidenceToggle.click();

    const evidenceDrawer = page.locator('#market-evidence-drawer');
    await expect(evidenceDrawer).toBeVisible();

    const evidenceTable = page.locator('#market-evidence-table');
    await expect(evidenceTable).toBeVisible();
    await expect(evidenceTable).toContainText('census-acs');
    await expect(evidenceTable).toContainText('census-cbp-zbp');
    await expect(evidenceTable).toContainText('osm-commercial');

    // 9. Test tab transition to Competition & HHI
    const competitionTab = page.locator('#market-tab-competition');
    await competitionTab.click();

    const compPanel = page.locator('#market-competition-panel');
    await expect(compPanel).toBeVisible();

    const hhiMetric = page.locator('#metric-hhi-score');
    await expect(hhiMetric).toBeVisible();

    const tierMetric = page.locator('#metric-concentration-tier');
    await expect(tierMetric).toBeVisible();

    // 10. Test tab transition to Location Comparison
    const comparisonTab = page.locator('#market-tab-comparison');
    await comparisonTab.click();

    const compTable = page.locator('#location-comparison-table');
    await expect(compTable).toBeVisible();
    await expect(compTable).toContainText('BENCHMARK');

    // 11. Capture visual screenshot for audit evidence
    const resultsDir = path.resolve('test-results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    await page.screenshot({
      path: path.join(resultsDir, 'market-analysis-inspector-evidence.png'),
      fullPage: true,
    });
  });
});
