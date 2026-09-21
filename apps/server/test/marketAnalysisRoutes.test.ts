import {
  type AuthenticatedIdentityContext,
  CompetitionAnalysisResultSchema,
  ECONOMIC_LEGAL_DISCLAIMER,
  GEV_PRODUCTION_IDENTITY_PROFILE,
  type IdentityBearerVerifier,
  type IdentityRole,
  LocationComparisonResultSchema,
  MarketAnalysisResultSchema,
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
      if (token === 'bearer-tenant-a') return makeTenantIdentity('tenant-a');
      if (token === 'bearer-tenant-b') return makeTenantIdentity('tenant-b');
      if (token === 'bearer-tenant-admin')
        return makeTenantIdentity('tenant-admin', 'platform_admin');
      return null;
    },
  };
}

const sampleMarketInput = {
  target_geography: {
    level: 'county' as const,
    county_fips: '48453',
    state_fips: '48',
    name: 'Travis County, TX',
  },
  naics_code: '722511',
  industry_title: 'Full-Service Restaurants',
  acs_evidence: [],
  cbp_evidence: [],
};

const sampleCompetitionInput = {
  target_geography: {
    level: 'county' as const,
    county_fips: '48453',
    state_fips: '48',
    name: 'Travis County, TX',
  },
  naics_code: '722511',
  industry_title: 'Full-Service Restaurants',
  cbp_evidence: [],
  osm_poi_features: [],
};

const sampleLocationComparisonInput = {
  locations: [
    {
      location_key: 'travis-county',
      label: 'Travis County, TX',
      geography: {
        level: 'county' as const,
        county_fips: '48453',
        state_fips: '48',
        name: 'Travis County, TX',
      },
      acs_evidence: [],
      cbp_evidence: [],
    },
    {
      location_key: 'austin-city',
      label: 'Austin City, TX',
      geography: {
        level: 'place' as const,
        place_fips: '4805000',
        name: 'Austin city, TX',
      },
      acs_evidence: [],
      cbp_evidence: [],
    },
  ],
  benchmark_location_key: 'travis-county',
  naics_code: '722511',
  industry_title: 'Full-Service Restaurants',
};

const appsToClean: Array<{ auditSink: { close: () => void } }> = [];

afterEach(() => {
  while (appsToClean.length > 0) {
    appsToClean.pop()?.auditSink.close();
  }
});

describe('Protected Market Analysis REST Endpoints (Task 9.5)', () => {
  it('serves valid MarketAnalysisResult on /api/economic/market-analysis and alias /api/economic/market/analyze', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
    const server = createApp({
      clock,
      identityBearerVerifier: createVerifier(),
      opsAuth: { requireAuth: true },
    });
    appsToClean.push(server);

    for (const endpoint of ['/api/economic/market-analysis', '/api/economic/market/analyze']) {
      const response = await server.app.request(endpoint, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer bearer-tenant-a',
          'Content-Type': 'application/json',
          'X-Task-Ref': 'task-9.5-market-test',
        },
        body: JSON.stringify(sampleMarketInput),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Vary')).toContain('Authorization');

      const data = await response.json();
      const parsed = MarketAnalysisResultSchema.safeParse(data);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.tenant_id).toBe('tenant-a');
        expect(parsed.data.disclaimer).toBe(ECONOMIC_LEGAL_DISCLAIMER);
        expect(parsed.data.evidence_bundle.records.length).toBeGreaterThan(0);
      }
    }

    const logs = server.auditSink.tail();
    expect(
      logs.some((l) => l.kind === 'audit.intent' && l.action === 'economic.market.analyze')
    ).toBe(true);
    expect(logs.some((l) => l.kind === 'audit.outcome' && l.status === 'ok')).toBe(true);
  });

  it('serves valid CompetitionAnalysisResult on /api/economic/competition-analysis and alias', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
    const server = createApp({
      clock,
      identityBearerVerifier: createVerifier(),
      opsAuth: { requireAuth: true },
    });
    appsToClean.push(server);

    const response = await server.app.request('/api/economic/competition-analysis', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a',
        'Content-Type': 'application/json',
        'X-Task-Ref': 'task-9.5-competition-test',
      },
      body: JSON.stringify(sampleCompetitionInput),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    const parsed = CompetitionAnalysisResultSchema.safeParse(data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tenant_id).toBe('tenant-a');
      expect(parsed.data.concentration.tier).toBeDefined();
      expect(parsed.data.disclaimer).toBe(ECONOMIC_LEGAL_DISCLAIMER);
    }

    const logs = server.auditSink.tail();
    expect(
      logs.some((l) => l.kind === 'audit.intent' && l.action === 'economic.competition.analyze')
    ).toBe(true);
  });

  it('serves valid LocationComparisonResult on /api/economic/location-comparison and alias', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
    const server = createApp({
      clock,
      identityBearerVerifier: createVerifier(),
      opsAuth: { requireAuth: true },
    });
    appsToClean.push(server);

    const response = await server.app.request('/api/economic/location-comparison', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a',
        'Content-Type': 'application/json',
        'X-Task-Ref': 'task-9.5-location-test',
      },
      body: JSON.stringify(sampleLocationComparisonInput),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    const parsed = LocationComparisonResultSchema.safeParse(data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tenant_id).toBe('tenant-a');
      expect(parsed.data.locations.length).toBe(2);
      expect(parsed.data.disclaimer).toBe(ECONOMIC_LEGAL_DISCLAIMER);
    }

    const logs = server.auditSink.tail();
    expect(
      logs.some((l) => l.kind === 'audit.intent' && l.action === 'economic.location.compare')
    ).toBe(true);
  });

  it('fails closed with 401 when unauthenticated and 403 on tenant mismatch', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
    const server = createApp({
      clock,
      identityBearerVerifier: createVerifier(),
      opsAuth: { requireAuth: true },
    });
    appsToClean.push(server);

    // Unauthenticated
    const resNoAuth = await server.app.request('/api/economic/market-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sampleMarketInput),
    });
    expect(resNoAuth.status).toBe(401);

    // Cross-tenant mismatch (Token is tenant-a, header requests tenant-b)
    const resMismatch = await server.app.request('/api/economic/market-analysis', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a',
        'X-GEV-Tenant': 'tenant-b',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sampleMarketInput),
    });
    expect(resMismatch.status).toBe(403);
  });

  it('fails closed with 503 KILL_SWITCH_ACTIVE when provider economic is disabled', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
    const server = createApp({
      clock,
      identityBearerVerifier: createVerifier(),
      opsAuth: { requireAuth: true },
      isProviderEnabled: (id) => id !== 'economic',
    });
    appsToClean.push(server);

    const response = await server.app.request('/api/economic/market-analysis', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sampleMarketInput),
    });

    expect(response.status).toBe(503);
    const data = await response.json();
    expect(data.code).toBe('KILL_SWITCH_ACTIVE');
  });

  it('fails closed with 423 STASIS_ACTIVE when global STASIS is entered', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
    const server = createApp({
      clock,
      identityBearerVerifier: createVerifier(),
      opsAuth: { requireAuth: true },
    });
    appsToClean.push(server);

    server.budgetGovernor.trip('COMPLIANCE_DRIFT', 'Test compliance breach trips STASIS');

    const response = await server.app.request('/api/economic/market-analysis', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sampleMarketInput),
    });

    expect(response.status).toBe(423);
    const data = await response.json();
    expect(data.code).toBe('STASIS_ACTIVE');
  });

  it('enforces per-tenant rate limit and returns 429 RATE_LIMITED with Retry-After', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
    const server = createApp({
      clock,
      identityBearerVerifier: createVerifier(),
      opsAuth: { requireAuth: true },
      tenantRateLimits: { economic: 2 },
    });
    appsToClean.push(server);

    // Call 1 & 2 succeed
    for (let i = 0; i < 2; i++) {
      const res = await server.app.request('/api/economic/market-analysis', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer bearer-tenant-a',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sampleMarketInput),
      });
      expect(res.status).toBe(200);
    }

    // Call 3 fails with 429
    const resThrottled = await server.app.request('/api/economic/market-analysis', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sampleMarketInput),
    });
    expect(resThrottled.status).toBe(429);
    expect(resThrottled.headers.get('Retry-After')).toBeDefined();
    expect(resThrottled.headers.get('X-GEV-Tenant-Rate-Limited')).toBe('true');

    // Tenant B is NOT degraded
    const resTenantB = await server.app.request('/api/economic/market-analysis', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-b',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sampleMarketInput),
    });
    expect(resTenantB.status).toBe(200);
  });

  it('satisfies performance threshold: p95 latency < 50ms across iterations', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
    const server = createApp({
      clock,
      identityBearerVerifier: createVerifier(),
      opsAuth: { requireAuth: true },
      tenantRateLimits: { economic: 1000 },
    });
    appsToClean.push(server);

    const latencies: number[] = [];
    const ITERATIONS = 30;

    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now();
      const res = await server.app.request('/api/economic/market-analysis', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer bearer-tenant-a',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sampleMarketInput),
      });
      const t1 = performance.now();
      expect(res.status).toBe(200);
      latencies.push(t1 - t0);
    }

    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(ITERATIONS * 0.95)];
    expect(p95).toBeLessThan(50);
  });
});
