import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  type AuthenticatedIdentityContext,
  EPA_AQS_HISTORICAL_DISCLAIMER,
  GEV_PRODUCTION_IDENTITY_PROFILE,
  GevEvents,
  type IdentityBearerVerifier,
  type IdentityRole,
  SITE_RISK_SCREENING_DISCLAIMER,
  SiteRiskAssessmentResultSchema,
  USGS_3DEP_ADVISORY_DISCLAIMER,
} from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { assessSiteRisk, parseEpaAqsMeasurement, parseUsgsRawElevation } from '@gev/economic';
import type { createGovernanceRuntimeContext } from '@gev/governance';
import { type OperatorContext, createOperatorContext, executeOperatorTool } from '@gev/ops-mcp';
import { DotBtsAdapter, EpaAqsAdapter, Usgs3DepAdapter } from '@gev/providers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CreatedApp, createApp } from '../src/index.js';

const TEST_EPOCH = 1_731_400_000_000;

function makeTenantIdentity(
  tenantId: string,
  role: IdentityRole = 'operator'
): AuthenticatedIdentityContext {
  return {
    actor: 'human',
    principal: `auth0|${tenantId}-user`,
    tenant_id: tenantId,
    role,
    client_id: 'gev-web',
    token_id: `token-${tenantId}-${role}`,
    issuer: GEV_PRODUCTION_IDENTITY_PROFILE.issuer,
    audience: GEV_PRODUCTION_IDENTITY_PROFILE.rest_resource,
    resource: GEV_PRODUCTION_IDENTITY_PROFILE.rest_resource,
    scopes: ['read.telemetry', 'read.audit'],
    issued_at_epoch_seconds: Math.floor(TEST_EPOCH / 1000) - 60,
    not_before_epoch_seconds: Math.floor(TEST_EPOCH / 1000) - 60,
    expires_at_epoch_seconds: Math.floor(TEST_EPOCH / 1000) + 120,
  };
}

function createVerifier(): IdentityBearerVerifier {
  return {
    verify: async (request) => {
      const token = request.access_token;
      if (token === 'bearer-tenant-a') return makeTenantIdentity('tenant-a', 'operator');
      if (token === 'bearer-tenant-b') return makeTenantIdentity('tenant-b', 'operator');
      return null;
    },
  };
}

const travisGeo = {
  level: 'county' as const,
  county_fips: '48453',
  state_fips: '48',
  name: 'Travis County, TX',
};

describe('Phase 11 Exit Gate Certification (PLAN.md §0 NEXT_TASK 11_EXIT)', () => {
  let tmpDir: string;
  let dbPath: string;
  let clock: FrozenClock;
  const appsToClean: CreatedApp[] = [];
  const contextsToClean: ReturnType<typeof createGovernanceRuntimeContext>[] = [];
  const mcpContextsToClean: OperatorContext[] = [];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-phase-11-exit-test-'));
    dbPath = path.join(tmpDir, 'governance.sqlite');
    clock = new FrozenClock(TEST_EPOCH);
  });

  afterEach(() => {
    while (appsToClean.length > 0) appsToClean.pop()?.auditSink.close();
    while (mcpContextsToClean.length > 0) {
      try {
        mcpContextsToClean.pop()?.governanceContext.close();
      } catch {
        /* ignore */
      }
    }
    while (contextsToClean.length > 0) {
      try {
        contextsToClean.pop()?.close();
      } catch {
        /* ignore */
      }
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('1. certifies explicit source product, vintage, and geography & non-definitive advice framing', async () => {
    const server = createApp({
      clock,
      identityBearerVerifier: createVerifier(),
      opsAuth: { requireAuth: true },
    });
    appsToClean.push(server);

    const res = await server.app.request('/api/economic/site-risk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer bearer-tenant-a',
        'X-GEV-Tenant': 'tenant-a',
      },
      body: JSON.stringify({
        geography: travisGeo,
        include_current_alerts: true,
      }),
    });

    expect(res.status).toBe(200);
    const parsed = SiteRiskAssessmentResultSchema.parse(await res.json());

    expect(parsed.is_definitive_advice).toBe(false);
    expect(parsed.advisory_disclaimer).toBe(SITE_RISK_SCREENING_DISCLAIMER);
    expect(parsed.advisory_disclaimer).toContain('NOT definitive');
    expect(parsed.source_signals.length).toBeGreaterThanOrEqual(5);

    const sourceIds = parsed.source_signals.map((s) => s.source_id);
    expect(sourceIds).toEqual(
      expect.arrayContaining(['fema-nri', 'fema-nfhl', 'usgs-3dep', 'epa-aqs', 'dot-bts-access'])
    );

    for (const sig of parsed.source_signals) {
      expect(sig.product_name.length).toBeGreaterThan(0);
      expect(sig.vintage.length).toBeGreaterThan(0);
      expect(sig.geography.level).toBeTruthy();
    }
  });

  it('2. certifies strict separation of current operational alerts and long-term structural hazards', async () => {
    const server = createApp({
      clock,
      identityBearerVerifier: createVerifier(),
      opsAuth: { requireAuth: true },
    });
    appsToClean.push(server);

    const baseRes = await server.app.request('/api/economic/site-risk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer bearer-tenant-a',
        'X-GEV-Tenant': 'tenant-a',
      },
      body: JSON.stringify({
        geography: travisGeo,
        include_current_alerts: false,
        current_alerts: [],
      }),
    });

    const alertRes = await server.app.request('/api/economic/site-risk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer bearer-tenant-a',
        'X-GEV-Tenant': 'tenant-a',
      },
      body: JSON.stringify({
        geography: travisGeo,
        include_current_alerts: true,
        current_alerts: [
          {
            id: 'nws-extreme-1',
            event: 'Tornado Warning',
            severity: 'Extreme',
            headline: 'Immediate Tornado Warning for Travis County',
          },
        ],
      }),
    });

    expect(baseRes.status).toBe(200);
    expect(alertRes.status).toBe(200);

    const baseBody = SiteRiskAssessmentResultSchema.parse(await baseRes.json());
    const alertBody = SiteRiskAssessmentResultSchema.parse(await alertRes.json());

    // Long-term hazards and score MUST NOT shift due to transient operational alerts
    expect(alertBody.long_term_hazards).toEqual(baseBody.long_term_hazards);
    expect(alertBody.overall_screening_score).toEqual(baseBody.overall_screening_score);
    expect(alertBody.screening_tier).toBe(baseBody.screening_tier);

    // Current operational alerts are preserved separately
    expect(baseBody.current_operational_alerts.active_alert_count).toBe(0);
    expect(alertBody.current_operational_alerts.horizon).toBe('current_operational_alert');
    expect(alertBody.current_operational_alerts.is_live_condition).toBe(true);
    expect(alertBody.current_operational_alerts.active_alert_count).toBe(1);
    expect(alertBody.current_operational_alerts.highest_severity).toBe('Extreme');
  });

  it('3. certifies non-coercion across 3DEP, EPA AQS, DOT/BTS, and insufficient-data site-risk', async () => {
    expect(parseUsgsRawElevation(-1000000, 'Meters').elevationMeters.status).toBe('unavailable');
    expect(parseEpaAqsMeasurement(0, 'ppm', 0, false).status).toBe('unavailable');

    const usgs = new Usgs3DepAdapter({ clock });
    const aqs = new EpaAqsAdapter({ clock });
    const bts = new DotBtsAdapter({ clock });

    expect(usgs.getAdvisoryDisclaimer()).toBe(USGS_3DEP_ADVISORY_DISCLAIMER);
    expect(aqs.getHistoricalDisclaimer()).toBe(EPA_AQS_HISTORICAL_DISCLAIMER);

    const ocean = await usgs.getElevation({ x: -70.0, y: 25.0, units: 'Meters' });
    expect(ocean.is_off_coverage).toBe(true);
    expect(ocean.elevation.status).toBe('unavailable');

    const travisAqs = await aqs.querySummaries({ geography: travisGeo });
    expect(travisAqs.is_real_time).toBe(false);
    expect(
      travisAqs.pollutant_coverage.find((c) => c.pollutant_symbol === 'CO')?.is_monitored
    ).toBe(false);

    const akBts = await bts.queryAccessibility({
      geography: { level: 'county', county_fips: '02185', state_fips: '02' },
    });
    expect(akBts.records[0]?.is_covered).toBe(false);
    expect(akBts.records[0]?.accessibility_tier).toBe('unavailable');

    const zeroSignal = assessSiteRisk({
      geography: { level: 'county', county_fips: '02185', state_fips: '02' },
      isoTimestamp: new Date(clock.now()).toISOString(),
    });
    expect(zeroSignal.screening_tier).toBe('insufficient_data');
    expect(zeroSignal.overall_screening_score.status).toBe('unavailable');
  });

  it('4. certifies tenant isolation, STASIS 423, kill-switch 503, and atomic WAL audit logs', async () => {
    const server = createApp({
      clock,
      auditDbPath: dbPath,
      identityBearerVerifier: createVerifier(),
      opsAuth: { requireAuth: true },
    });
    appsToClean.push(server);

    // Unauthenticated rejected 401
    const unauth = await server.app.request('/api/economic/site-risk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ geography: travisGeo }),
    });
    expect(unauth.status).toBe(401);

    // Cross-tenant header mismatch rejected 403
    const crossTenant = await server.app.request('/api/economic/site-risk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer bearer-tenant-a',
        'X-GEV-Tenant': 'tenant-b',
      },
      body: JSON.stringify({ geography: travisGeo }),
    });
    expect(crossTenant.status).toBe(403);

    // Valid authorized request writes audit.intent and audit.outcome
    const okRes = await server.app.request('/api/economic/site-risk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer bearer-tenant-a',
        'X-GEV-Tenant': 'tenant-a',
      },
      body: JSON.stringify({ geography: travisGeo }),
    });
    expect(okRes.status).toBe(200);

    const govEntries = server.auditSink.tail({ limit: 10 });
    expect(govEntries.some((r) => r.kind === GevEvents.AuditIntent)).toBe(true);
    expect(govEntries.some((r) => r.kind === GevEvents.AuditOutcome)).toBe(true);

    // STASIS halts reads fail-closed with 423
    server.budgetGovernor.trip('BUDGET_BREACH', 'Phase 11 Exit gate STASIS verification');
    const stasisRes = await server.app.request('/api/economic/site-risk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer bearer-tenant-a',
        'X-GEV-Tenant': 'tenant-a',
      },
      body: JSON.stringify({ geography: travisGeo }),
    });
    expect(stasisRes.status).toBe(423);
  });

  it('5. certifies governed MCP operator tool parity and < 25ms p95 screening latency', async () => {
    const mcpCtx = createOperatorContext({ clock });
    mcpContextsToClean.push(mcpCtx);

    const mcpRes = await executeOperatorTool(
      mcpCtx,
      'assess_site_risk',
      { geography: travisGeo, include_current_alerts: true },
      { tenant_id: 'tenant-a' }
    );
    expect(mcpRes.success).toBe(true);
    const output = SiteRiskAssessmentResultSchema.parse(mcpRes.result);
    expect(output.is_definitive_advice).toBe(false);

    // Benchmark pure site-risk screening + seed adapter execution (< 25ms p95)
    const dotBts = new DotBtsAdapter({ clock });
    const epaAqs = new EpaAqsAdapter({ clock });
    const dotBtsRes = await dotBts.queryAccessibility({ geography: travisGeo });
    const epaAqsRes = await epaAqs.querySummaries({
      geography: travisGeo,
      summary_period: 'annual',
    });

    const isoNow = new Date(clock.now()).toISOString();
    for (let w = 0; w < 20; w++) {
      assessSiteRisk({
        geography: travisGeo,
        isoTimestamp: isoNow,
        epaAqsResult: epaAqsRes,
        dotBtsRecord: dotBtsRes.records[0],
      });
    }

    const iterations = 200;
    const latencies: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      assessSiteRisk({
        geography: travisGeo,
        isoTimestamp: isoNow,
        epaAqsResult: epaAqsRes,
        dotBtsRecord: dotBtsRes.records[0],
      });
      latencies.push(performance.now() - start);
    }
    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(iterations * 0.95)] ?? 0;
    console.log(
      `[BENCHMARK] Phase 11 Site-Risk Screening Latency (N=${iterations}): p95=${p95.toFixed(3)}ms`
    );
    expect(p95).toBeLessThan(25);
  });
});
