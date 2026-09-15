import {
  type AuthenticatedIdentityContext,
  GEV_PRODUCTION_IDENTITY_PROFILE,
  type IdentityBearerVerifier,
  type IdentityRole,
} from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { createGovernanceRuntimeContext } from '@gev/governance';
import { describe, expect, it } from 'vitest';
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
      if (token === 'bearer-tenant-admin') return makeTenantIdentity('tenant-admin', 'platform_admin');
      return null;
    },
  };
}

describe('Tenant Quota, Rate Limit, Cache Partitioning & Kill-Switch Governance (Task 7.2)', () => {
  it('strictly isolates per-tenant rate limits so Tenant A burst does not degrade Tenant B', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
    const verifier = createVerifier();
    const { app } = createApp({
      clock,
      identityBearerVerifier: verifier,
      tenantRateLimits: { flights: 2 },
      costGovernorOptions: {
        requireAuth: true,
      },
    });

    // Request 1 from Tenant A: Allowed (MISS)
    const resA1 = await app.request('/api/flights?q=1', {
      headers: { Authorization: 'Bearer bearer-tenant-a' },
    });
    expect(resA1.status).toBe(200);

    // Request 2 from Tenant A: Allowed (MISS)
    const resA2 = await app.request('/api/flights?q=2', {
      headers: { Authorization: 'Bearer bearer-tenant-a' },
    });
    expect(resA2.status).toBe(200);

    // Request 3 from Tenant A: Rate limit exceeded (limit is 2 req/min)
    const resA3 = await app.request('/api/flights?q=3', {
      headers: { Authorization: 'Bearer bearer-tenant-a' },
    });
    expect(resA3.status).toBe(429);
    expect(resA3.headers.get('X-GEV-Tenant-Rate-Limited')).toBe('true');
    const a3Body = (await resA3.json()) as { code: string; error: string };
    expect(a3Body.code).toBe('TENANT_RATE_LIMITED');
    expect(a3Body.error).toContain('tenant-a');

    // Request 1 from Tenant B: Completely unaffected by Tenant A exhaustion
    const resB1 = await app.request('/api/flights?q=1', {
      headers: { Authorization: 'Bearer bearer-tenant-b' },
    });
    expect(resB1.status).toBe(200);
    expect(resB1.headers.get('X-GEV-Tenant-Rate-Limited')).toBeNull();

    // Request 2 from Tenant B: Still allowed
    const resB2 = await app.request('/api/flights?q=2', {
      headers: { Authorization: 'Bearer bearer-tenant-b' },
    });
    expect(resB2.status).toBe(200);
  });

  it('strictly isolates per-tenant budget so Tenant A budget exhaustion does not block Tenant B', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
    const verifier = createVerifier();
    const govContext = createGovernanceRuntimeContext({
      clock,
      dbPath: ':memory:',
      capUsd: 10,
    });

    // Allocate $0.0005 to Tenant A and $0.010 to Tenant B
    govContext.budgetLedger.setTenantCap('tenant-a', 500);
    govContext.budgetLedger.setTenantCap('tenant-b', 10_000);

    const { app, budgetGovernor } = createApp({
      clock,
      governanceContext: govContext,
      identityBearerVerifier: verifier,
      costGovernorOptions: {
        requireAuth: true,
        tiers: {
          ships: { ttlSeconds: 5, costPerFetchUsd: 0.0005, maxStaleSeconds: 60 },
        },
      },
    });

    // Tenant A spend 1: spends $0.0005 (exactly reaches cap)
    const resA1 = await app.request('/api/ships?query=1', {
      headers: {
        Authorization: 'Bearer bearer-tenant-a',
        'Idempotency-Key': '00000000-0000-4000-8000-000000000001',
      },
    });
    expect(resA1.status).toBe(200);

    // Tenant A spend 2: denied due to Tenant A budget exhaustion
    const resA2 = await app.request('/api/ships?query=2', {
      headers: {
        Authorization: 'Bearer bearer-tenant-a',
        'Idempotency-Key': '00000000-0000-4000-8000-000000000002',
      },
    });
    expect(resA2.status).toBe(429);
    const a2Body = (await resA2.json()) as { code: string; error: string };
    expect(a2Body.code).toBe('BUDGET_DENIED');
    expect(a2Body.error).toContain('tenant: tenant-a');

    // Global STASIS is NOT active
    expect(budgetGovernor.state().stasis_active).toBe(false);

    // Tenant B can still spend freely within their own quota
    const resB1 = await app.request('/api/ships?query=1', {
      headers: {
        Authorization: 'Bearer bearer-tenant-b',
        'Idempotency-Key': '00000000-0000-4000-8000-000000000003',
      },
    });
    expect(resB1.status).toBe(200);

    // Verify tenant budget balances in durable ledger
    const budgetA = govContext.budgetLedger.getTenantBudget('tenant-a');
    const budgetB = govContext.budgetLedger.getTenantBudget('tenant-b');
    expect(budgetA.spent_microusd).toBe(500);
    expect(budgetA.cap_microusd - budgetA.spent_microusd).toBe(0);
    expect(budgetB.spent_microusd).toBe(500);
    expect(budgetB.cap_microusd - budgetB.spent_microusd).toBe(9_500);
  });

  it('partitions response cache per-tenant and delivers cache hits in < 10ms', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
    const verifier = createVerifier();
    const { app } = createApp({
      clock,
      identityBearerVerifier: verifier,
      costGovernorOptions: {
        requireAuth: true,
      },
    });

    // 1. Tenant A fetches: Cache MISS
    const resA1 = await app.request('/api/ships?region=us', {
      headers: { Authorization: 'Bearer bearer-tenant-a' },
    });
    expect(resA1.status).toBe(200);
    expect(resA1.headers.get('X-GEV-Cache')).toBe('MISS');

    // 2. Tenant A fetches same resource: Cache HIT < 10ms
    // Warm up JIT for Hono routing dispatch and token verification
    for (let i = 0; i < 5; i++) {
      await app.request('/api/ships?region=us', {
        headers: { Authorization: 'Bearer bearer-tenant-a' },
      });
    }
    const hitStart = performance.now();
    const resA2 = await app.request('/api/ships?region=us', {
      headers: { Authorization: 'Bearer bearer-tenant-a' },
    });
    const hitDuration = performance.now() - hitStart;
    expect(resA2.status).toBe(200);
    expect(resA2.headers.get('X-GEV-Cache')).toBe('HIT');
    expect(hitDuration).toBeLessThan(10);

    // 3. Tenant B fetches same URL: must be Cache MISS (strict tenant partitioning)
    const resB1 = await app.request('/api/ships?region=us', {
      headers: { Authorization: 'Bearer bearer-tenant-b' },
    });
    expect(resB1.status).toBe(200);
    expect(resB1.headers.get('X-GEV-Cache')).toBe('MISS');
  });

  it('immediately invalidates cache on kill-switch or flag toggle', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
    const verifier = createVerifier();
    const { app, costGovernor } = createApp({
      clock,
      identityBearerVerifier: verifier,
      costGovernorOptions: {
        requireAuth: true,
      },
    });

    // Warm cache for Tenant A
    const res1 = await app.request('/api/flights?tag=test', {
      headers: { Authorization: 'Bearer bearer-tenant-a' },
    });
    expect(res1.status).toBe(200);

    // Confirm cache HIT
    const res2 = await app.request('/api/flights?tag=test', {
      headers: { Authorization: 'Bearer bearer-tenant-a' },
    });
    expect(res2.headers.get('X-GEV-Cache')).toBe('HIT');

    // Invalidate provider on kill switch / flag toggle
    costGovernor.invalidate('flights');

    // Next request is MISS (cache immediately wiped)
    const res3 = await app.request('/api/flights?tag=test', {
      headers: { Authorization: 'Bearer bearer-tenant-a' },
    });
    expect(res3.status).toBe(200);
    expect(res3.headers.get('X-GEV-Cache')).toBe('MISS');
  });

  it('fails closed with 503 when provider is disabled by kill-switch policy', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
    const verifier = createVerifier();
    let killSwitchActive = false;

    const { app } = createApp({
      clock,
      identityBearerVerifier: verifier,
      isProviderEnabled: (name) => {
        if (name === 'flights' && killSwitchActive) return false;
        return true;
      },
      costGovernorOptions: {
        requireAuth: true,
      },
    });

    // Normal access
    const resOk = await app.request('/api/flights', {
      headers: { Authorization: 'Bearer bearer-tenant-a' },
    });
    expect(resOk.status).toBe(200);

    // Trip kill-switch
    killSwitchActive = true;

    // Subsequent access fails closed immediately with 503
    const resKilled = await app.request('/api/flights', {
      headers: { Authorization: 'Bearer bearer-tenant-a' },
    });
    expect(resKilled.status).toBe(503);
    const body = (await resKilled.json()) as { code: string; error: string };
    expect(body.code).toBe('KILL_SWITCH_ACTIVE');
    expect(body.error).toContain('disabled by kill-switch policy');
  });

  it('fails closed with 401 on unauthenticated access when requireAuth is enforced', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
    const verifier = createVerifier();
    const { app } = createApp({
      clock,
      identityBearerVerifier: verifier,
      costGovernorOptions: {
        requireAuth: true,
      },
    });

    // Unauthenticated request to quota-governed endpoint fails with 401
    const res = await app.request('/api/flights');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe('UNAUTHENTICATED_QUOTA_ACCESS');

    // Authenticated request succeeds
    const resAuth = await app.request('/api/flights', {
      headers: { Authorization: 'Bearer bearer-tenant-a' },
    });
    expect(resAuth.status).toBe(200);
  });
});
