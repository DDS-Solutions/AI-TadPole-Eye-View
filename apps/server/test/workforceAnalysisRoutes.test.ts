import {
  type AuthenticatedIdentityContext,
  ECONOMIC_LEGAL_DISCLAIMER,
  GEV_PRODUCTION_IDENTITY_PROFILE,
  type IdentityBearerVerifier,
  type IdentityRole,
  WORKFORCE_LABOR_MARKET_SIGNAL_DISCLAIMER,
  WorkforceAnalysisResultSchema,
} from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { afterEach, describe, expect, it } from 'vitest';
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

const sampleWorkforceInput = {
  target_geography: {
    level: 'cbsa' as const,
    cbsa_code: '12420',
    name: 'Austin-Round Rock-Georgetown, TX',
  },
  soc_code: '15-1252',
  occupation_title: 'Software Developers',
  oews_evidence: [],
  lau_evidence: [],
};

describe('Protected Workforce Analysis REST Routes (Task 10.2 & ADR 0061)', () => {
  const appsToClean: CreatedApp[] = [];

  afterEach(() => {
    while (appsToClean.length > 0) {
      appsToClean.pop()?.auditSink.close();
    }
  });

  it('runs protected workforce analysis returning schema-valid labor-market signals and disclaimers', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
    const server = createApp({
      clock,
      identityBearerVerifier: createVerifier(),
      opsAuth: { requireAuth: true },
    });
    appsToClean.push(server);

    for (const endpoint of [
      '/api/economic/workforce-analysis',
      '/api/economic/workforce/analyze',
    ]) {
      const res = await server.app.request(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer bearer-tenant-a',
          'X-GEV-Tenant': 'tenant-a',
        },
        body: JSON.stringify(sampleWorkforceInput),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('no-store');

      const body = await res.json();
      const validated = WorkforceAnalysisResultSchema.parse(body);

      expect(validated.tenant_id).toBe('tenant-a');
      expect(validated.soc_code).toBe('15-1252');
      expect(validated.signal_type).toBe('aggregate_labor_market_survey_signal');
      expect(validated.disclaimer).toBe(WORKFORCE_LABOR_MARKET_SIGNAL_DISCLAIMER);
      expect(validated.legal_disclaimer).toBe(ECONOMIC_LEGAL_DISCLAIMER);
      expect(validated.wage_differentials).toBeDefined();
      expect(validated.unemployment_dynamics).toBeDefined();
    }
  });

  it('fails closed with 401 when unauthenticated and requireAuth is active', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
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
      },
      body: JSON.stringify(sampleWorkforceInput),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('Unauthorized');
  });

  it('fails closed with 403 on cross-tenant resource mismatch', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
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
        'X-GEV-Tenant': 'tenant-b', // Header mismatch
      },
      body: JSON.stringify(sampleWorkforceInput),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Forbidden');
  });

  it('fails closed with 400 when applicant or worker PII is submitted', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
    const server = createApp({
      clock,
      identityBearerVerifier: createVerifier(),
      opsAuth: { requireAuth: true },
    });
    appsToClean.push(server);

    const piiInput = {
      ...sampleWorkforceInput,
      applicant_id: 'app-9911',
    };

    const res = await server.app.request('/api/economic/workforce-analysis', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer bearer-tenant-a',
        'X-GEV-Tenant': 'tenant-a',
      },
      body: JSON.stringify(piiInput),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid workforce analysis input');
  });

  it('fails closed with 423 when STASIS is active', async () => {
    const clock = new FrozenClock(TEST_EPOCH);
    const server = createApp({
      clock,
      identityBearerVerifier: createVerifier(),
      opsAuth: { requireAuth: true },
    });
    appsToClean.push(server);

    server.budgetGovernor.trip('BUDGET_BREACH', 'Manual test stasis');

    const res = await server.app.request('/api/economic/workforce-analysis', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer bearer-tenant-a',
        'X-GEV-Tenant': 'tenant-a',
      },
      body: JSON.stringify(sampleWorkforceInput),
    });

    expect(res.status).toBe(423);
    const body = await res.json();
    expect(body.error).toContain('STASIS');
  });
});
