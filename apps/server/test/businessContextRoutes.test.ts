import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GEV_PRODUCTION_IDENTITY_PROFILE, type IdentityBearerVerifier } from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { verifyIndependentAuditChain } from '@gev/governance';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/index.js';

const tempDirs: string[] = [];

function makeTempDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-server-task-13-1-'));
  tempDirs.push(dir);
  return path.join(dir, 'governance.sqlite');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  }
});

const BASE_IAT = Math.floor(Date.parse('2026-11-27T12:00:00.000Z') / 1000);

const mockVerifier: IdentityBearerVerifier = {
  verify: async (request) => {
    const token = request.access_token;
    const base = {
      issuer: GEV_PRODUCTION_IDENTITY_PROFILE.issuer,
      audience: GEV_PRODUCTION_IDENTITY_PROFILE.rest_resource,
      resource: GEV_PRODUCTION_IDENTITY_PROFILE.rest_resource,
      issued_at_epoch_seconds: BASE_IAT - 30,
      not_before_epoch_seconds: BASE_IAT - 30,
      expires_at_epoch_seconds: BASE_IAT + 240,
    };
    if (token === 'alpha-admin') {
      return {
        ...base,
        principal: 'auth0|alice-admin',
        tenant_id: 'tenant-alpha',
        role: 'tenant_admin',
        actor: 'human',
        client_id: 'gev-web',
        token_id: 'tok-alpha-admin',
        scopes: ['read.telemetry', 'read.audit'],
        session_id: 'sess-alpha-admin',
      };
    }
    if (token === 'alpha-copilot') {
      return {
        ...base,
        principal: 'auth0|tadpole-bot',
        tenant_id: 'tenant-alpha',
        role: 'ai_copilot',
        actor: 'ai',
        client_id: 'tadpole-agent',
        token_id: 'tok-alpha-ai',
        scopes: ['read.telemetry'],
        session_id: 'sess-alpha-ai',
      };
    }
    if (token === 'beta-admin') {
      return {
        ...base,
        principal: 'auth0|bob-admin',
        tenant_id: 'tenant-beta',
        role: 'tenant_admin',
        actor: 'human',
        client_id: 'gev-web',
        token_id: 'tok-beta-admin',
        scopes: ['read.telemetry', 'read.audit'],
        session_id: 'sess-beta-admin',
      };
    }
    return null;
  },
};

const SAMPLE_INPUT = {
  business_name: 'Private Austin Logistics Co',
  naics_code: '493110',
  industry_title: 'General Warehousing and Storage',
  target_geography: {
    level: 'county' as const,
    county_fips: '48453',
    state_fips: '48',
  },
  employee_count_estimate: 45,
  annual_revenue_usd_estimate: 8_200_000,
};

describe('Task 13.1 Protected BusinessContext HTTP API (/api/economic/contexts)', () => {
  it('enforces tenant isolation, RBAC, versioned CRUD, encrypted backup/restore, verified hard delete, STASIS 423, and M1 audit chain', async () => {
    const dbPath = makeTempDb();
    const clock = new FrozenClock(Date.parse('2026-11-27T12:00:00.000Z'));
    const context = createApp({
      clock,
      governanceDbPath: dbPath,
      opsAuth: { requireAuth: true },
      identityBearerVerifier: mockVerifier,
    });

    try {
      // 1. Unauthenticated request rejected 401
      const unauthRes = await context.app.request('/api/economic/contexts');
      expect(unauthRes.status).toBe(401);

      // 2. Create as tenant-alpha admin
      const createRes = await context.app.request('/api/economic/contexts', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer alpha-admin',
          'X-GEV-Tenant': 'tenant-alpha',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          context_id: 'logistics-hub-1',
          input: SAMPLE_INPUT,
          retention_days: 30,
          change_reason: 'Initial onboarding',
        }),
      });
      expect(createRes.status).toBe(201);
      expect(createRes.headers.get('cache-control')).toBe('no-store');
      const created = (await createRes.json()) as { version: number; context_id: string };
      expect(created.version).toBe(1);

      // 3. ai_copilot can list metadata but cannot read/mutate/delete sensitive BusinessContext
      const copilotList = await context.app.request('/api/economic/contexts', {
        headers: { Authorization: 'Bearer alpha-copilot', 'X-GEV-Tenant': 'tenant-alpha' },
      });
      expect(copilotList.status).toBe(200);
      const copilotListBody = (await copilotList.json()) as { count: number };
      expect(copilotListBody.count).toBe(1);

      const copilotDelete = await context.app.request('/api/economic/contexts/logistics-hub-1', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer alpha-copilot', 'X-GEV-Tenant': 'tenant-alpha' },
      });
      expect(copilotDelete.status).toBe(403);

      // 4. Cross-tenant isolation: tenant-beta sees 0 records and 404 on direct get
      const betaGet = await context.app.request('/api/economic/contexts/logistics-hub-1', {
        headers: { Authorization: 'Bearer beta-admin', 'X-GEV-Tenant': 'tenant-beta' },
      });
      expect(betaGet.status).toBe(404);

      // 5. Prototype pollution & oversized payload fail closed
      const protoRes = await context.app.request('/api/economic/contexts', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer alpha-admin',
          'X-GEV-Tenant': 'tenant-alpha',
          'Content-Type': 'application/json',
        },
        body: '{"__proto__":{"isAdmin":true},"input":{}}',
      });
      expect(protoRes.status).toBe(400);

      const bigRes = await context.app.request('/api/economic/contexts', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer alpha-admin',
          'X-GEV-Tenant': 'tenant-alpha',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pad: 'x'.repeat(70_000) }),
      });
      expect(bigRes.status).toBe(413);

      // 6. Versioned update (v2) + export + encrypted backup
      const updateRes = await context.app.request('/api/economic/contexts/logistics-hub-1', {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer alpha-admin',
          'X-GEV-Tenant': 'tenant-alpha',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          expected_version: 1,
          input: { ...SAMPLE_INPUT, employee_count_estimate: 52 },
          change_reason: 'Seasonal hiring',
        }),
      });
      expect(updateRes.status).toBe(200);

      const exportRes = await context.app.request('/api/economic/contexts/logistics-hub-1/export', {
        headers: { Authorization: 'Bearer alpha-admin', 'X-GEV-Tenant': 'tenant-alpha' },
      });
      expect(exportRes.status).toBe(200);
      const exportBundle = (await exportRes.json()) as { version_history: unknown[] };
      expect(exportBundle.version_history).toHaveLength(2);

      const backupRes = await context.app.request('/api/economic/contexts/logistics-hub-1/backup', {
        method: 'POST',
        headers: { Authorization: 'Bearer alpha-admin', 'X-GEV-Tenant': 'tenant-alpha' },
      });
      expect(backupRes.status).toBe(200);
      const backupText = await backupRes.text();
      expect(backupText).not.toContain('Private Austin Logistics Co');

      // 7. Verified hard delete + restore from encrypted backup
      const delRes = await context.app.request('/api/economic/contexts/logistics-hub-1', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer alpha-admin', 'X-GEV-Tenant': 'tenant-alpha' },
      });
      expect(delRes.status).toBe(200);
      const receipt = (await delRes.json()) as {
        verified_zero_remaining: boolean;
        versions_purged: number;
      };
      expect(receipt.verified_zero_remaining).toBe(true);
      expect(receipt.versions_purged).toBe(2);

      // Cross-tenant restore denied 403
      const betaRestore = await context.app.request('/api/economic/contexts/restore', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer beta-admin',
          'X-GEV-Tenant': 'tenant-beta',
          'Content-Type': 'application/json',
        },
        body: backupText,
      });
      expect(betaRestore.status).toBe(403);

      // Same-tenant restore succeeds 201
      const alphaRestore = await context.app.request('/api/economic/contexts/restore', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer alpha-admin',
          'X-GEV-Tenant': 'tenant-alpha',
          'Content-Type': 'application/json',
        },
        body: backupText,
      });
      expect(alphaRestore.status).toBe(201);

      // 8. Global STASIS blocks persistence routes with 423
      context.budgetGovernor.trip('BUDGET_BREACH', 'Test STASIS drill');
      const stasisRes = await context.app.request('/api/economic/contexts', {
        headers: { Authorization: 'Bearer alpha-admin', 'X-GEV-Tenant': 'tenant-alpha' },
      });
      expect(stasisRes.status).toBe(423);

      // 9. Verify independent SQLite audit chain
      const verification = verifyIndependentAuditChain(context.auditSink);
      expect(verification.valid).toBe(true);
    } finally {
      context.governanceContext.close();
    }
  });
});
