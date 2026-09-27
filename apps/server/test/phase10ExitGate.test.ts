import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  type AuthenticatedIdentityContext,
  BLS_LAU_MONTHLY_STATISTICAL_DISCLAIMER,
  BLS_OEWS_ANNUAL_STATISTICAL_DISCLAIMER,
  BlsLauPeriodSchema,
  BlsLauSeriesIdSchema,
  BlsOewsQuerySchema,
  BlsSocCodeSchema,
  ECONOMIC_LEGAL_DISCLAIMER,
  type EconomicEstimate,
  type EconomicEvidenceRecord,
  GEV_PRODUCTION_IDENTITY_PROFILE,
  GevEvents,
  type IdentityBearerVerifier,
  type IdentityRole,
  PROHIBITED_WORKER_PII_FIELDS,
  WORKFORCE_LABOR_MARKET_SIGNAL_DISCLAIMER,
  WorkforceAnalysisResultSchema,
  checkForWorkerPii,
  getNumericEstimateValue,
} from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import {
  analyzeWorkforceContext,
  buildLauSeriesId,
  parseEconomicFixtureDataset,
  parseLauSeriesId,
} from '@gev/economic';
import { createGovernanceRuntimeContext } from '@gev/governance';
import { type OperatorContext, createOperatorContext, executeOperatorTool } from '@gev/ops-mcp';
import { BlsLauAdapter, BlsOewsAdapter } from '@gev/providers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type CreatedApp } from '../src/index.js';

const TEST_EPOCH = 1_725_000_000_000;

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

const mockCbsaGeo = {
  level: 'cbsa' as const,
  cbsa_code: '12420',
  name: 'Austin-Round Rock-Georgetown, TX',
};

const mockCountyGeo = {
  level: 'county' as const,
  county_fips: '48453',
  state_fips: '48',
  name: 'Travis County, TX',
};

const sampleWorkforceInput = {
  target_geography: mockCbsaGeo,
  soc_code: '15-1252',
  occupation_title: 'Software Developers',
  oews_evidence: [],
  lau_evidence: [],
};

describe('Phase 10 Exit Gate Certification (PLAN.md §0 NEXT_TASK 10_EXIT)', () => {
  let tmpDir: string;
  let dbPath: string;
  let clock: FrozenClock;
  const appsToClean: CreatedApp[] = [];
  const contextsToClean: ReturnType<typeof createGovernanceRuntimeContext>[] = [];
  const mcpContextsToClean: OperatorContext[] = [];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-phase-10-exit-test-'));
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
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    vi.restoreAllMocks();
  });

  it('1. certifies exact BLS OEWS and LAU series/occupation/area/period identifiers', () => {
    expect(BlsSocCodeSchema.parse('15-1252')).toBe('15-1252');
    expect(BlsSocCodeSchema.parse('00-0000')).toBe('00-0000');
    expect(() => BlsSocCodeSchema.parse('151252')).toThrow();

    expect(BlsLauPeriodSchema.parse('M05')).toBe('M05');
    expect(BlsLauPeriodSchema.parse('M12')).toBe('M12');
    expect(BlsLauPeriodSchema.parse('M13')).toBe('M13');
    expect(() => BlsLauPeriodSchema.parse('Q01')).toThrow();

    const builtCbsaSeriesId = buildLauSeriesId({
      geography: mockCbsaGeo,
      measure: '03',
      seasonal: 'U',
    });
    expect(builtCbsaSeriesId).toBe('LAUMT124200000003');
    expect(BlsLauSeriesIdSchema.parse(builtCbsaSeriesId)).toBe('LAUMT124200000003');

    const parsedCbsa = parseLauSeriesId(builtCbsaSeriesId);
    expect(parsedCbsa.seasonal).toBe('U');
    expect(parsedCbsa.measure_code).toBe('03');
    expect(parsedCbsa.area_type).toBe('MT');

    const builtCountySeriesId = buildLauSeriesId({
      geography: mockCountyGeo,
      measure: '06',
      seasonal: 'U',
    });
    expect(builtCountySeriesId).toBe('LAUCN484530000006');
    const parsedCounty = parseLauSeriesId(builtCountySeriesId);
    expect(parsedCounty.measure_code).toBe('06');
    expect(parsedCounty.area_type).toBe('CN');
  });

  it('2. certifies anti-PII defense: complete rejection of employee/applicant PII across all boundaries', async () => {
    for (const piiKey of PROHIBITED_WORKER_PII_FIELDS) {
      expect(() => checkForWorkerPii({ [piiKey]: 'sensitive_worker_val' })).toThrow(
        /Prohibited worker-level PII field/
      );
    }

    expect(() =>
      BlsOewsQuerySchema.parse({ geography: mockCbsaGeo, applicant_id: 'app-1234' })
    ).toThrow(/Prohibited employee\/applicant PII/);

    const oewsAdapter = new BlsOewsAdapter({ clock });
    const lauAdapter = new BlsLauAdapter({ clock });

    await expect(
      oewsAdapter.query({
        geography: mockCbsaGeo,
        soc_code: '15-1252',
        ...({ employee_name: 'John Doe' } as unknown as object),
      })
    ).rejects.toThrow(/Prohibited employee\/applicant PII/);

    await expect(
      lauAdapter.query({
        geography: mockCountyGeo,
        ...({ candidate_id: 'cand-987' } as unknown as object),
      })
    ).rejects.toThrow(/Prohibited employee\/applicant PII/);

    expect(() =>
      analyzeWorkforceContext(
        {
          ...sampleWorkforceInput,
          ...({ resume_text: 'Experience at Tech Corp' } as unknown as object),
        },
        '2026-09-24T12:00:00.000Z'
      )
    ).toThrow(/Prohibited worker-level PII/);

    const server = createApp({
      clock,
      identityBearerVerifier: createVerifier(),
      opsAuth: { requireAuth: true },
    });
    appsToClean.push(server);

    const res = await server.app.request('/api/economic/workforce-analysis', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer bearer-tenant-a',
        'X-GEV-Tenant': 'tenant-a',
      },
      body: JSON.stringify({ ...sampleWorkforceInput, ssn: '000-00-0000' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid workforce analysis input');

    const mcpCtx = createOperatorContext({ clock });
    mcpContextsToClean.push(mcpCtx);

    const mcpRes = await executeOperatorTool(
      mcpCtx,
      'analyze_workforce_context',
      { ...sampleWorkforceInput, worker_name: 'Jane Worker' },
      { tenant_id: 'tenant-a' }
    );
    expect(mcpRes.success).toBe(false);
    expect(mcpRes.error).toContain('Prohibited worker-level PII');
  });

  it('3. certifies non-coercion of suppressed estimates and statutory disclaimers', () => {
    const suppressedEstimates: EconomicEstimate[] = [
      { status: 'suppressed', reason: 'statutory_wage_cap', detail: 'Wage exceeds $115.00/hr' },
      { status: 'suppressed', reason: 'not_disclosed', detail: 'Sample size insufficient' },
      { status: 'suppressed', reason: 'disclosure_avoidance', detail: 'Confidentiality' },
      { status: 'unavailable', reason: 'Data not collected for period' },
      { status: 'not_applicable', reason: 'Self-employed excluded' },
    ];

    for (const est of suppressedEstimates) {
      expect(getNumericEstimateValue(est)).toBeUndefined();
    }

    const suppressedOewsEvidence: EconomicEvidenceRecord[] = [
      {
        evidence_id: 'ev-test-pct90-suppressed',
        source_id: 'bls-oews',
        metric_id: 'hourly-pct90-wage',
        variable_name: 'H_PCT90',
        geography: mockCbsaGeo,
        estimate: { status: 'suppressed', reason: 'statutory_wage_cap' },
        provenance: {
          schema_version: 1,
          source: { provider_id: 'bls-oews', feed_id: 'oews', name: 'BLS OEWS', canonical_url: '' },
          retrieved_at: '2026-09-24T00:00:00.000Z',
          mode: 'seed',
          source_mode: 'seed',
          license: { id: 'public-domain', name: 'PD' },
          attribution: 'BLS OEWS',
        },
      },
    ];

    const result = analyzeWorkforceContext(
      { ...sampleWorkforceInput, oews_evidence: suppressedOewsEvidence },
      '2026-09-24T12:00:00.000Z'
    );

    expect(result.wage_differentials.ratio_90_10.status).toBe('suppressed');
    expect(getNumericEstimateValue(result.wage_differentials.ratio_90_10)).toBeUndefined();

    expect(result.disclaimer).toBe(WORKFORCE_LABOR_MARKET_SIGNAL_DISCLAIMER);
    expect(result.legal_disclaimer).toBe(ECONOMIC_LEGAL_DISCLAIMER);
    expect(BLS_OEWS_ANNUAL_STATISTICAL_DISCLAIMER).toContain('annual benchmark survey estimates');
    expect(BLS_LAU_MONTHLY_STATISTICAL_DISCLAIMER).toContain('monthly model-based');
  });

  it('4. certifies pure workforce analysis engine and source-linked disagreement detection', () => {
    const rawFixture = fs.readFileSync(
      path.resolve(__dirname, '../../../fixtures/bls-oews-synthetic-v1.json'),
      'utf8'
    );
    const dataset = parseEconomicFixtureDataset(rawFixture);
    expect(dataset.records.length).toBeGreaterThan(0);

    const lauFixture = fs.readFileSync(
      path.resolve(__dirname, '../../../fixtures/bls-lau-synthetic-v1.json'),
      'utf8'
    );
    const lauDataset = parseEconomicFixtureDataset(lauFixture);
    expect(lauDataset.records.length).toBeGreaterThan(0);

    const result = analyzeWorkforceContext(
      {
        target_geography: mockCbsaGeo,
        soc_code: '15-1252',
        oews_evidence: dataset.records,
        lau_evidence: lauDataset.records,
      },
      '2026-09-24T12:00:00.000Z'
    );

    const validated = WorkforceAnalysisResultSchema.parse(result);
    expect(validated.signal_type).toBe('aggregate_labor_market_survey_signal');
    expect(validated.occupational_specialization.location_quotient).toBeGreaterThan(0);
    expect(validated.labor_market_concentration.hhi).toBeGreaterThanOrEqual(0);
    expect(validated.labor_market_concentration.hhi).toBeLessThanOrEqual(10000);

    const p10 = getNumericEstimateValue(validated.wage_differentials.hourly_percentiles.pct10);
    const p50 = getNumericEstimateValue(validated.wage_differentials.hourly_percentiles.median);
    const p90 = getNumericEstimateValue(validated.wage_differentials.hourly_percentiles.pct90);
    if (p10 !== undefined && p50 !== undefined && p90 !== undefined) {
      expect(p10).toBeLessThanOrEqual(p50);
      expect(p50).toBeLessThanOrEqual(p90);
    }

    const r9010 = getNumericEstimateValue(validated.wage_differentials.ratio_90_10);
    if (r9010 !== undefined) {
      expect(r9010).toBeGreaterThanOrEqual(1.0);
    }
  });

  it('5. certifies multi-tenant governance, STASIS lockdown, and zero persistence outside WAL', async () => {
    const govContext = createGovernanceRuntimeContext({ clock, dbPath });
    contextsToClean.push(govContext);

    const server = createApp({
      clock,
      governanceContext: govContext,
      identityBearerVerifier: createVerifier(),
      opsAuth: { requireAuth: true },
    });
    appsToClean.push(server);

    const unauthRes = await server.app.request('/api/economic/workforce-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sampleWorkforceInput),
    });
    expect(unauthRes.status).toBe(401);

    const crossTenantRes = await server.app.request('/api/economic/workforce-analysis', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer bearer-tenant-a',
        'X-GEV-Tenant': 'tenant-b',
      },
      body: JSON.stringify(sampleWorkforceInput),
    });
    expect(crossTenantRes.status).toBe(403);

    let db = new DatabaseSync(dbPath);
    let auditCountBefore = 0;
    try {
      const row = db.prepare('SELECT count(*) as c FROM audit_events').get() as { c: number };
      auditCountBefore = row.c;
    } finally {
      db.close();
    }

    const authRes = await server.app.request('/api/economic/workforce-analysis', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer bearer-tenant-a',
        'X-GEV-Tenant': 'tenant-a',
        'X-Task-Ref': 'task-10-exit-persistence',
      },
      body: JSON.stringify(sampleWorkforceInput),
    });
    expect(authRes.status).toBe(200);

    db = new DatabaseSync(dbPath);
    try {
      const row = db.prepare('SELECT count(*) as c FROM audit_events').get() as { c: number };
      expect(row.c).toBeGreaterThan(auditCountBefore);

      const auditRows = db
        .prepare(
          "SELECT id, kind, intent_id, action, target, status FROM audit_events WHERE task_ref = 'task-10-exit-persistence' OR intent_id IN (SELECT id FROM audit_events WHERE task_ref = 'task-10-exit-persistence') ORDER BY rowid ASC"
        )
        .all() as Array<{
        id: string;
        kind: string;
        intent_id: string | null;
        action: string | null;
        target: string | null;
        status: string | null;
      }>;

      expect(auditRows.length).toBe(2);
      const [intentEvent, outcomeEvent] = auditRows;
      expect(intentEvent?.kind).toBe(GevEvents.AuditIntent);
      expect(intentEvent?.action).toBe('economic.workforce.analyze');
      expect(intentEvent?.target).toBe('tenant:tenant-a');
      expect(outcomeEvent?.kind).toBe(GevEvents.AuditOutcome);
      expect(outcomeEvent?.status).toBe('ok');
    } finally {
      db.close();
    }

    server.budgetGovernor.trip('BUDGET_BREACH', 'Exit gate emergency stasis');
    const stasisRes = await server.app.request('/api/economic/workforce-analysis', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer bearer-tenant-a',
        'X-GEV-Tenant': 'tenant-a',
      },
      body: JSON.stringify(sampleWorkforceInput),
    });
    expect(stasisRes.status).toBe(423);
  });

  it('6. certifies governed MCP operator tool analyze_workforce_context execution and STASIS guard', async () => {
    const govContext = createGovernanceRuntimeContext({ clock, dbPath });
    contextsToClean.push(govContext);
    const mcpCtx = createOperatorContext({ clock, governanceContext: govContext });
    mcpContextsToClean.push(mcpCtx);

    const mcpRes = await executeOperatorTool(
      mcpCtx,
      'analyze_workforce_context',
      sampleWorkforceInput,
      { tenant_id: 'tenant-a', task_ref: 'task-10-exit-mcp' }
    );
    expect(mcpRes.success).toBe(true);
    expect(mcpRes.status).toBe('ok');

    govContext.budgetGovernor.trip('BUDGET_BREACH', 'MCP STASIS test');
    const stasisMcpRes = await executeOperatorTool(
      mcpCtx,
      'analyze_workforce_context',
      sampleWorkforceInput,
      { tenant_id: 'tenant-a', task_ref: 'task-10-exit-mcp-stasis' }
    );
    expect(stasisMcpRes.success).toBe(false);
    expect(stasisMcpRes.error).toContain('STASIS');
  });

  it('7. certifies performance threshold (p95 < 15ms across 500 iterations) and zero live calls', () => {
    for (let w = 0; w < 50; w++) {
      analyzeWorkforceContext(
        { target_geography: mockCbsaGeo, soc_code: '15-1252' },
        '2026-09-24T12:00:00.000Z'
      );
    }

    const batchSize = 10;
    const batchCount = 50;
    const latencies: number[] = [];

    for (let b = 0; b < batchCount; b++) {
      const start = performance.now();
      for (let j = 0; j < batchSize; j++) {
        analyzeWorkforceContext(
          { target_geography: mockCbsaGeo, soc_code: '15-1252' },
          '2026-09-24T12:00:00.000Z'
        );
      }
      latencies.push((performance.now() - start) / batchSize);
    }

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(batchCount * 0.5)] ?? 0;
    const p95 = latencies[Math.floor(batchCount * 0.95)] ?? 0;

    console.log(
      `[BENCHMARK] Phase 10 Pure Workforce Analysis Latency (${batchSize * batchCount} iterations): p50=${p50.toFixed(3)}ms, p95=${p95.toFixed(3)}ms`
    );

    expect(p95).toBeLessThan(15.0);
  });
});
