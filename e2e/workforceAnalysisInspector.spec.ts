import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

test.describe('Workforce & Labor Dynamics HUD Inspector (Task 10.2)', () => {
  test('renders workforce tab with statutory labor-market signal banner, unemployment dynamics, wage percentiles, occupational specialization, and evidence drawer', async ({
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

    // 2. Condition-wait for Intelligence view and Inspector container to mount
    const inspector = page.locator('#market-analysis-inspector');
    await expect(inspector).toBeVisible();

    // 3. Switch to Workforce & Wages tab
    const workforceTabBtn = page.locator('#tab-btn-workforce');
    await expect(workforceTabBtn).toBeVisible();
    await workforceTabBtn.click();

    // 4. Verify SOC preset selector becomes visible
    const socSelect = page.locator('#workforce-inspector-soc-select');
    await expect(socSelect).toBeVisible();
    await expect(socSelect).toHaveValue('15-1252');

    // 5. Condition-wait for workforce tab content to mount
    const workforceContent = page.locator('#workforce-tab-content');
    await expect(workforceContent).toBeVisible();

    // 6. Verify statutory Labor-Market Signal Banner
    const signalBanner = page.locator('#workforce-labor-market-signal-banner');
    await expect(signalBanner).toBeVisible();
    await expect(signalBanner).toContainText('STATISTICAL LABOR-MARKET SIGNAL');
    await expect(signalBanner).toContainText(
      'Not live job postings, individual candidate/worker records, or automated hiring decisions'
    );

    // 7. Verify Unemployment & Labor Dynamics card
    const unemploymentCard = page.locator('#workforce-unemployment-card');
    await expect(unemploymentCard).toBeVisible();

    const unempRate = page.locator('#metric-unemployment-rate');
    await expect(unempRate).toBeVisible();
    await expect(unempRate).not.toHaveText('0%');
    await expect(unempRate).not.toHaveText('N/A%');

    const laborForce = page.locator('#metric-labor-force');
    await expect(laborForce).toBeVisible();
    await expect(laborForce).not.toHaveText('0');

    // 8. Verify Wage Differentials & Percentiles card
    const wagesCard = page.locator('#workforce-wages-card');
    await expect(wagesCard).toBeVisible();

    const medianWage = page.locator('#metric-wage-median');
    await expect(medianWage).toBeVisible();
    await expect(medianWage).toContainText('$');

    const pct10Wage = page.locator('#metric-wage-pct10');
    await expect(pct10Wage).toBeVisible();
    await expect(pct10Wage).toContainText('$');

    const ratio9010 = page.locator('#metric-ratio-9010');
    await expect(ratio9010).toBeVisible();

    // 9. Verify Occupational Specialization (Location Quotient)
    const specCard = page.locator('#workforce-specialization-card');
    await expect(specCard).toBeVisible();

    const lqMetric = page.locator('#metric-location-quotient');
    await expect(lqMetric).toBeVisible();
    await expect(lqMetric).not.toHaveText('N/A');

    const lqTier = page.locator('#metric-specialization-tier');
    await expect(lqTier).toBeVisible();

    // 10. Verify Labor-Market Concentration Card
    const concCard = page.locator('#workforce-concentration-card');
    await expect(concCard).toBeVisible();

    const hhiMetric = page.locator('#metric-workforce-hhi');
    await expect(hhiMetric).toBeVisible();

    // 11. Test Evidence Inspection Drawer toggle
    const evidenceToggle = page.locator('#workforce-evidence-toggle');
    await expect(evidenceToggle).toBeVisible();
    await evidenceToggle.click();

    const evidenceDrawer = page.locator('#workforce-evidence-drawer');
    await expect(evidenceDrawer).toBeVisible();
    await expect(evidenceDrawer).toContainText('MODE: SEED');
    await expect(evidenceDrawer).toContainText('bls-oews');
    await expect(evidenceDrawer).toContainText('bls-lau');

    // 12. Test changing SOC selection to Registered Nurses
    await socSelect.selectOption('29-1141');
    const runBtn = page.locator('#market-inspector-run-btn');
    await runBtn.click();

    await expect(page.locator('#workforce-specialization-card')).toContainText('29-1141');

    // 13. Capture visual screenshot for audit evidence
    const resultsDir = path.resolve('test-results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    await page.screenshot({
      path: path.join(resultsDir, 'workforce-analysis-inspector-evidence.png'),
      fullPage: true,
    });
  });
});
