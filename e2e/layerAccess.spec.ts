import fs from 'node:fs';
import path from 'node:path';
import type { LayerAccessEntry, LayerAccessReadModel } from '@gev/contracts';
import { expect, test } from '@playwright/test';

const RESULTS_DIR = path.resolve('test-results');

function entry(model: LayerAccessReadModel, id: string): LayerAccessEntry {
  const result = model.entries.find((candidate) => candidate.id === id);
  if (!result) throw new Error(`Missing Layer Access entry '${id}'`);
  return result;
}

function exposeGateStatus(target: LayerAccessEntry): void {
  target.credential.local_status = { visibility: 'available', reason: null };
  target.terms.local_status = { visibility: 'available', reason: null };
  target.configuration.local_status = { visibility: 'available', reason: null };
}

function applyStateMatrix(model: LayerAccessReadModel): LayerAccessReadModel {
  model.authority = {
    kind: 'authenticated_local_operator',
    credential_status_access: 'masked_status',
    reason: null,
  };

  const healthy = entry(model, 'opensky');
  exposeGateStatus(healthy);
  healthy.credential.status = 'valid';
  healthy.credential.masked_fingerprint = '•••••••• A91C';
  healthy.credential.validated_at = model.generated_at;
  healthy.terms.status = 'approved';
  healthy.terms.reviewed_at = model.generated_at;
  healthy.configuration.current_state = 'valid';
  healthy.configuration.checked_at = model.generated_at;

  const credential = entry(model, 'aisstream');
  exposeGateStatus(credential);
  credential.credential.status = 'missing';
  credential.terms.status = 'approved';
  credential.configuration.current_state = 'valid';
  credential.effective_access = 'setup_required';
  credential.lock_reasons = [
    { gate: 'credential', code: 'credential-missing', message: 'Credential status is missing' },
  ];

  const terms = entry(model, 'celestrak');
  exposeGateStatus(terms);
  terms.credential.status = 'not_required';
  terms.terms.status = 'pending_approval';
  terms.configuration.current_state = 'valid';
  terms.effective_access = 'approval_required';
  terms.lock_reasons = [
    { gate: 'terms', code: 'terms-pending', message: 'Terms status is pending approval' },
  ];

  const configuration = entry(model, 'nasa-firms');
  exposeGateStatus(configuration);
  configuration.credential.status = 'valid';
  configuration.credential.masked_fingerprint = '•••••••• 42F0';
  configuration.terms.status = 'approved';
  configuration.configuration.current_state = 'missing';
  configuration.effective_access = 'configuration_required';
  configuration.lock_reasons = [
    {
      gate: 'configuration',
      code: 'configuration-missing',
      message: 'Configuration status is missing',
    },
  ];

  const policy = entry(model, 'usgs');
  policy.policy.enabled = false;
  policy.policy.reason = 'Disabled by platform policy for this snapshot';
  policy.effective_access = 'disabled';
  policy.lock_reasons = [
    {
      gate: 'policy',
      code: 'disabled-by-policy',
      message: 'Disabled by platform policy for this snapshot',
    },
  ];

  const stale = entry(model, 'noaa-nws-alerts');
  stale.runtime.status = 'stale';
  stale.runtime.observation_at = '2026-09-06T19:55:00.000Z';
  stale.runtime.retrieved_at = model.generated_at;
  stale.runtime.detail = 'Source observation is older than its registered freshness policy';

  const unavailable = entry(model, 'dot-traffic');
  unavailable.runtime.status = 'unavailable';
  unavailable.runtime.detail = 'No approved agency source is configured';
  unavailable.effective_access = 'unavailable';
  unavailable.lock_reasons = [
    {
      gate: 'runtime',
      code: 'source-unavailable',
      message: 'No approved agency source is configured',
    },
  ];

  const stasis = entry(model, 'rainviewer');
  stasis.policy.stasis_active = true;
  stasis.effective_access = 'stasis';
  stasis.lock_reasons = [
    { gate: 'policy', code: 'stasis-active', message: 'STASIS suspends all layer activation' },
  ];
  return model;
}

test('discovers every registry entry and distinguishes the complete Layer Access state matrix', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.route('**/ops/layer-access', async (route) => {
    const upstream = await route.fetch();
    const model = (await upstream.json()) as LayerAccessReadModel;
    await route.fulfill({ response: upstream, json: applyStateMatrix(model) });
  });
  await page.goto('/');
  await page.locator('#open-layer-access').click();

  const panel = page.getByRole('dialog', { name: 'Layer Access' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button').filter({ hasText: /.+/ })).toHaveCount(20);
  await expect(page.locator('[id^="layer-access-entry-"]')).toHaveCount(19);
  await expect(page.locator('#layer-access-entry-opensky')).toHaveAttribute(
    'aria-label',
    /OpenSky Network: available/i
  );
  await expect(page.locator('#layer-access-entry-aisstream')).toHaveAttribute(
    'aria-label',
    /setup required/i
  );
  await expect(page.locator('#layer-access-entry-celestrak')).toHaveAttribute(
    'aria-label',
    /approval required/i
  );
  await expect(page.locator('#layer-access-entry-nasa-firms')).toHaveAttribute(
    'aria-label',
    /configuration required/i
  );
  await expect(page.locator('#layer-access-entry-usgs')).toHaveAttribute('aria-label', /disabled/i);
  await expect(page.locator('#layer-access-entry-rainviewer')).toHaveAttribute(
    'aria-label',
    /stasis/i
  );
  await expect(page.locator('#layer-access-entry-noaa-nowcoast')).toHaveAttribute(
    'aria-label',
    /planned/i
  );
  await expect(page.locator('#layer-access-entry-dot-traffic')).toHaveAttribute(
    'aria-label',
    /unavailable/i
  );

  await page.locator('#layer-access-entry-noaa-nws-alerts').click();
  await expect(panel).toContainText(
    'Source observation is older than its registered freshness policy'
  );
  await expect(panel).toContainText('STALE');

  await page.locator('#layer-access-entry-opensky').click();
  await expect(panel.getByLabel('Masked credential fingerprint')).toHaveText('•••••••• A91C');
  await expect(panel).not.toContainText('local-operator-token');
  await expect(panel.getByRole('link', { name: 'Setup' })).toHaveAttribute('href', /^https:\/\//);
  await expect(panel.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', /^https:\/\//);
  await expect(panel.getByRole('link', { name: 'Attribution' })).toHaveAttribute(
    'href',
    /^https:\/\//
  );
  await expect(panel.getByRole('link', { name: 'Source document' })).toHaveAttribute(
    'href',
    /docs\/data-sources\/flights\.md$/
  );

  await page.locator('#layer-access-filter').selectOption('planned');
  await expect(page.locator('[id^="layer-access-entry-"]')).toHaveCount(3);
  await expect(panel).toContainText('3 shown of 19');
  await page.locator('#layer-access-filter').selectOption('all');
  await page.locator('#layer-access-search').fill('no matching registry entry');
  await expect(panel).toContainText('No accepted registry entries match these filters.');
  await page.locator('#layer-access-search').fill('OpenSky');
  await expect(page.locator('[id^="layer-access-entry-"]')).toHaveCount(1);
  await page.locator('#layer-access-search').fill('');
  await expect(page.locator('[id^="layer-access-entry-"]')).toHaveCount(19);
  await page.locator('#layer-access-entry-opensky').click();

  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  await panel.screenshot({
    path: path.join(RESULTS_DIR, 'task-5.3.5-layer-access-state-matrix.png'),
    style: '#layer-access-panel { backdrop-filter: none !important; }',
  });
});

test('opens the exact locked layer requirement and returns keyboard focus on close', async ({
  page,
}) => {
  await page.route('**/api/satellites', async (route) => {
    await route.fulfill({
      status: 423,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'TERMS_APPROVAL_REQUIRED',
        error: 'Live satellite access is locked pending recorded terms approval',
      }),
    });
  });
  await page.goto('/');
  const setup = page.locator('#satellite-layer-row').getByRole('button', { name: 'Set up' });
  await expect(setup).toBeVisible();
  await setup.focus();
  await setup.press('Enter');
  await expect(page.locator('#layer-access-entry-celestrak')).toBeFocused();
  await page.getByRole('button', { name: 'Close Layer Access settings' }).last().click();
  await expect(setup).toBeFocused();
});

test('recovers from a bounded Layer Access read error without hiding the failure', async ({
  page,
}) => {
  let attempt = 0;
  await page.route('**/ops/layer-access', async (route) => {
    attempt += 1;
    if (attempt === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'LAYER_ACCESS_UNAVAILABLE', error: 'Synthetic read failure' }),
      });
      return;
    }
    await route.continue();
  });
  await page.goto('/');
  await page.locator('#open-layer-access').click();
  const panel = page.getByRole('dialog', { name: 'Layer Access' });
  await expect(panel.getByRole('alert')).toContainText('Layer Access unavailable');
  await panel.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('[id^="layer-access-entry-"]')).toHaveCount(19);
});
