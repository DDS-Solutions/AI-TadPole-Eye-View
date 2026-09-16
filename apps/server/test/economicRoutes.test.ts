import {
  ECONOMIC_LEGAL_DISCLAIMER,
  type AuthenticatedIdentityContext,
  BusinessContextPreviewSchema,
  GEV_PRODUCTION_IDENTITY_PROFILE,
  type IdentityBearerVerifier,
  type IdentityRole,
} from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/index.js';

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
    token_id: `token-${tenantId}`,
    issuer: GEV_PRODUCTION_IDENTITY_PROFILE.issuer,
    audience: GEV_PRODUCTION_IDENTITY_PROFILE.rest_resource,
    resource: GEV_PRODUCTION_IDENTITY_PROFILE.rest_resource,
    scopes: ['read.telemetry', 'read.audit', 'write.scenes', 'write.flags'],
    issued_at_epoch_seconds: Math.floor(TEST_EPOCH / 1000) - 60,
    not_before_epoch_seconds: Math.floor(TEST_EPOCH / 1000) - 60,
    expires_at_epoch_seconds: Math.floor(TEST_EPOCH / 1000) + 120,
  };
}

function createVerifier(): IdentityBearerVerifier {
  return {
    verify: async (request) => {
      const token = request.access_token;
      if (token === 'bearer-tenant-a') return makeTenantIdentity('tenant-a');
      if (token === 'bearer-tenant-b') return makeTenantIdentity('tenant-b');
      if (token === 'bearer-tenant-admin')
        return makeTenantIdentity('tenant-admin', 'platform_admin');
      return null;
    },
  };
}

const samplePayload = {
  business_name: 'Apex AI Systems',
  naics_code: '541511',
  industry_title: 'Custom Computer Programming Services',
  target_geography: {
    level: 'county' as const,
    county_fips: '48453',
    state_fips: '48',
    name: 'Travis County, TX',
  },
  operating_radius_meters: 25000,
  employee_count_estimate: 45,
  annual_revenue_usd_estimate: 5000000,
};

const appsToClean: Array<{ auditSink: { close: () => void } }> = [];

afterEach(() => {
  while (appsToClean.length > 0) {
    appsToClean.pop()?.auditSink.close();
  }
});

describe('Protected Stateless Economic Preview API (Task 8.4)', () => {
  it('serves valid BusinessContextPreview with legal disclaimer on /api/economic/preview and alias /api/economic/business-context/preview', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
    const server = createApp({
      clock,
      identityBearerVerifier: createVerifier(),
      opsAuth: { requireAuth: true },
    });
    appsToClean.push(server);

    for (const endpoint of ['/api/economic/preview', '/api/economic/business-context/preview']) {
      const response = await server.app.request(endpoint, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer bearer-tenant-a',
          'Content-Type': 'application/json',
          'X-Task-Ref': 'task-8.4-preview-test',
        },
        body: JSON.stringify(samplePayload),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Vary')).toContain('Authorization');

      const data = await response.json();
      const parsed = BusinessContextPreviewSchema.safeParse(data);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.tenant_id).toBe('tenant-a');
        expect(parsed.data.input.business_name).toBe('Apex AI Systems');
        expect(parsed.data.input.naics_code).toBe('541511');
        expect(parsed.data.disclaimer).toBe(ECONOMIC_LEGAL_DISCLAIMER);
        expect(parsed.data.provenance.mode).toBe('seed');
        expect(parsed.data.evidence.length).toBeGreaterThanOrEqual(6);
        expect(Object.keys(parsed.data.summary_estimates).length).toBeGreaterThan(0);
      }
    }
  });

  it('fails closed on missing, invalid, or cross-tenant authentication', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
    const server = createApp({
      clock,
      identityBearerVerifier: createVerifier(),
      opsAuth: { requireAuth: true },
    });
    appsToClean.push(server);

    // 1. Missing Authorization header -> 401
    const missingAuth = await server.app.request('/api/economic/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(samplePayload),
    });
    expect(missingAuth.status).toBe(401);
    const missingAuthBody = await missingAuth.json();
    expect(missingAuthBody.code).toBe('MISSING_BEARER_TOKEN');

    // 2. Invalid Bearer Token -> 401
    const invalidAuth = await server.app.request('/api/economic/preview', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer invalid-secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(samplePayload),
    });
    expect(invalidAuth.status).toBe(401);
    const invalidAuthBody = await invalidAuth.json();
    expect(invalidAuthBody.code).toBe('INVALID_BEARER_TOKEN');

    // 3. Cross-tenant mismatch (Token is tenant-a, header requests tenant-b) -> 403
    const crossTenant = await server.app.request('/api/economic/preview', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a',
        'X-GEV-Tenant': 'tenant-b',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(samplePayload),
    });
    expect(crossTenant.status).toBe(403);
    const crossTenantBody = await crossTenant.json();
    expect(crossTenantBody.code).toBe('TENANT_ACCESS_DENIED');
  });

  it('rejects invalid JSON or invalid business context parameters with 400', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
    const server = createApp({
      clock,
      identityBearerVerifier: createVerifier(),
      opsAuth: { requireAuth: true },
    });
    appsToClean.push(server);

    // Malformed JSON
    const malformed = await server.app.request('/api/economic/preview', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a',
        'Content-Type': 'application/json',
      },
      body: 'not a valid json {',
    });
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).code).toBe('INVALID_INPUT');

    // Invalid schema input (missing required naics_code)
    const invalidSchema = await server.app.request('/api/economic/preview', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ business_name: 'Missing NAICS' }),
    });
    expect(invalidSchema.status).toBe(400);
    expect((await invalidSchema.json()).code).toBe('INVALID_INPUT');
  });

  it('enforces kill-switch policy immediately with 503', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
    const server = createApp({
      clock,
      identityBearerVerifier: createVerifier(),
      opsAuth: { requireAuth: true },
      isProviderEnabled: (p) => p !== 'economic',
    });
    appsToClean.push(server);

    const response = await server.app.request('/api/economic/preview', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(samplePayload),
    });

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe('KILL_SWITCH_ACTIVE');
  });

  it('halts execution under global STASIS and isolates tenant STASIS with 423', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
    const server = createApp({
      clock,
      identityBearerVerifier: createVerifier(),
      opsAuth: { requireAuth: true },
    });
    appsToClean.push(server);

    // 1. Trip tenant-a into STASIS
    server.budgetLedger.tripTenant('tenant-a', 'BUDGET_BREACH', 'Tenant A quota exceeded');

    // Tenant A gets 423 TENANT_STASIS_ACTIVE
    const resA = await server.app.request('/api/economic/preview', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(samplePayload),
    });
    expect(resA.status).toBe(423);
    expect((await resA.json()).code).toBe('TENANT_STASIS_ACTIVE');

    // Tenant B is untouched and succeeds with 200
    const resB = await server.app.request('/api/economic/preview', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-b',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(samplePayload),
    });
    expect(resB.status).toBe(200);

    // 2. Trip global governor into STASIS
    server.budgetGovernor.trip('BUDGET_BREACH', 'Global emergency lockdown');

    // Now Tenant B also gets 423 STASIS_ACTIVE
    const resBGlobal = await server.app.request('/api/economic/preview', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-b',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(samplePayload),
    });
    expect(resBGlobal.status).toBe(423);
    expect((await resBGlobal.json()).code).toBe('STASIS_ACTIVE');
  });

  it('strictly isolates per-tenant rate limits so Tenant A burst does not degrade Tenant B', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
    const server = createApp({
      clock,
      identityBearerVerifier: createVerifier(),
      opsAuth: { requireAuth: true },
      tenantRateLimits: { economic: 2 },
    });
    appsToClean.push(server);

    // Tenant A Request 1: Allowed
    const resA1 = await server.app.request('/api/economic/preview', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(samplePayload),
    });
    expect(resA1.status).toBe(200);

    // Tenant A Request 2: Allowed
    const resA2 = await server.app.request('/api/economic/preview', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(samplePayload),
    });
    expect(resA2.status).toBe(200);

    // Tenant A Request 3: Rate limited (limit is 2 req/min)
    const resA3 = await server.app.request('/api/economic/preview', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(samplePayload),
    });
    expect(resA3.status).toBe(429);
    expect(resA3.headers.get('Retry-After')).toBeDefined();
    expect(resA3.headers.get('X-GEV-Tenant-Rate-Limited')).toBe('true');
    expect((await resA3.json()).code).toBe('RATE_LIMITED');

    // Tenant B is isolated and immediately succeeds
    const resB = await server.app.request('/api/economic/preview', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-b',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(samplePayload),
    });
    expect(resB.status).toBe(200);
  });

  it('maintains zero persistence outside the WAL audit trail', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
    const server = createApp({
      clock,
      identityBearerVerifier: createVerifier(),
      opsAuth: { requireAuth: true },
    });
    appsToClean.push(server);

    const taskRef = 'task-8.4-audit-trace';
    const response = await server.app.request('/api/economic/preview', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a',
        'Content-Type': 'application/json',
        'X-Task-Ref': taskRef,
      },
      body: JSON.stringify(samplePayload),
    });
    expect(response.status).toBe(200);

    // Query audit entries for this task
    const entries = server.auditSink.tailByTaskRef(taskRef, 10);
    expect(entries.length).toBe(2);

    const intent = entries.find((e) => e.kind === 'audit.intent');
    expect(intent).toBeDefined();
    expect(intent?.action).toBe('economic.business_context.preview');
    expect(intent?.target).toBe('tenant:tenant-a');
    expect(intent?.actor).toBe('human');

    const outcome = entries.find((e) => e.kind === 'audit.outcome');
    expect(outcome).toBeDefined();
    expect(outcome?.intent_id).toBe(intent?.id);
    expect(outcome?.status).toBe('ok');

    // Verify zero budget spend or operation reservations
    const tenantBudget = server.budgetLedger.getTenantBudget('tenant-a');
    expect(tenantBudget.spent_microusd).toBe(0);
    const held = server.budgetLedger.getTenantHeldMicrousd('tenant-a');
    expect(held).toBe(0);
  });

  it('preserves suppressed metrics without coercing to zero', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
    const server = createApp({
      clock,
      identityBearerVerifier: createVerifier(),
      opsAuth: { requireAuth: true },
    });
    appsToClean.push(server);

    const response = await server.app.request('/api/economic/preview', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(samplePayload),
    });
    expect(response.status).toBe(200);

    const data = await response.json();
    const parsed = BusinessContextPreviewSchema.parse(data);

    // Filter evidence items for suppressed status
    const suppressedEvidence = parsed.evidence.filter((e) => e.estimate.status === 'suppressed');
    expect(suppressedEvidence.length).toBeGreaterThan(0);
    for (const suppressed of suppressedEvidence) {
      expect(suppressed.estimate.status).toBe('suppressed');
      // Must not coerce to numeric zero; value is undefined/null
      expect((suppressed.estimate as { value?: unknown }).value).toBeUndefined();
    }
  });

  it('meets performance threshold responding < 25ms p95 across 50 iterations', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
    const server = createApp({
      clock,
      identityBearerVerifier: createVerifier(),
      opsAuth: { requireAuth: true },
    });
    appsToClean.push(server);

    const iterations = 50;
    const durations: number[] = [];

    // Warm-up calls
    for (let w = 0; w < 5; w++) {
      await server.app.request('/api/economic/preview', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer bearer-tenant-a',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(samplePayload),
      });
    }

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const res = await server.app.request('/api/economic/preview', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer bearer-tenant-a',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(samplePayload),
      });
      const end = performance.now();
      expect(res.status).toBe(200);
      durations.push(end - start);
    }

    durations.sort((a, b) => a - b);
    const p95Index = Math.floor(iterations * 0.95);
    const p95Latency = durations[p95Index];

    // Assert strictly against the performance threshold (< 25ms p95)
    expect(p95Latency).toBeLessThan(25);
  });
});
