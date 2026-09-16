import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  type AuthenticatedIdentityContext,
  GEV_PRODUCTION_IDENTITY_PROFILE,
  type IdentityActor,
  type IdentityBearerVerifier,
  type IdentityRole,
  LayerAccessReadModelSchema,
} from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { createGovernanceRuntimeContext } from '@gev/governance';
import { createProviderRegistry } from '@gev/providers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/index.js';

const TEST_EPOCH = 1_726_000_000_000;

function makeTenantIdentity(
  tenantId: string,
  role: IdentityRole = 'tenant_admin',
  actor: IdentityActor = 'human'
): AuthenticatedIdentityContext {
  const isAi = actor === 'ai';
  return {
    actor,
    principal: isAi ? `agent:${tenantId}-bot` : `auth0|${tenantId}-user`,
    tenant_id: tenantId,
    role: isAi ? 'ai_copilot' : role,
    client_id: 'gev-web',
    token_id: `token-${tenantId}-${role}`,
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
      if (token === 'bearer-tenant-a-admin') return makeTenantIdentity('tenant-a', 'tenant_admin');
      if (token === 'bearer-tenant-a-op') return makeTenantIdentity('tenant-a', 'operator');
      if (token === 'bearer-tenant-a-viewer') return makeTenantIdentity('tenant-a', 'viewer');
      if (token === 'bearer-tenant-a-ai') return makeTenantIdentity('tenant-a', 'ai_copilot', 'ai');
      if (token === 'bearer-tenant-b-admin') return makeTenantIdentity('tenant-b', 'tenant_admin');
      return null;
    },
  };
}

describe('Phase 7 Exit Gate Verification (PLAN.md §0 NEXT_TASK 7_EXIT)', () => {
  let tmpDir: string;
  let dbPath: string;
  let clock: FrozenClock;
  const contexts: ReturnType<typeof createGovernanceRuntimeContext>[] = [];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-phase-7-exit-test-'));
    dbPath = path.join(tmpDir, 'governance.sqlite');
    clock = new FrozenClock(TEST_EPOCH);
  });

  afterEach(() => {
    for (const ctx of contexts.splice(0)) {
      try {
        ctx.close();
      } catch {
        // ignore
      }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('cross-tenant access fails closed across all roles, callers, and headers', async () => {
    const verifier = createVerifier();
    const govContext = createGovernanceRuntimeContext({ clock, dbPath });
    contexts.push(govContext);
    const { app } = createApp({
      clock,
      governanceContext: govContext,
      identityBearerVerifier: verifier,
      opsAuth: { requireAuth: true },
    });

    // 1. Tenant A submits credentials
    const credPayload = JSON.stringify({
      provider_id: 'opensky',
      secret_kind: 'api_key',
      secret_value: 'tenant-a-secret-XYZ1234',
    });
    const submitRes = await app.request('/ops/layer-access/credentials', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a-admin',
        'Content-Type': 'application/json',
      },
      body: credPayload,
    });
    expect(submitRes.status).toBe(200);

    // 2. Cross-tenant header injection: Tenant A claims to act on Tenant B -> 403
    const crossTenantHeaderRes = await app.request('/ops/layer-access/credentials', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a-admin',
        'X-GEV-Tenant': 'tenant-b',
        'Content-Type': 'application/json',
      },
      body: credPayload,
    });
    expect(crossTenantHeaderRes.status).toBe(403);
    expect((await crossTenantHeaderRes.json()).code).toBe('TENANT_ACCESS_DENIED');

    // 3. Unauthenticated caller to protected layer-access routes -> 401
    const unauthSubmit = await app.request('/ops/layer-access/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: credPayload,
    });
    expect(unauthSubmit.status).toBe(401);

    const unauthValidate = await app.request('/ops/layer-access/credentials/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider_id: 'opensky' }),
    });
    expect(unauthValidate.status).toBe(401);

    // 4. Operator role attempting admin mutation -> 403
    const opRes = await app.request('/ops/layer-access/credentials', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a-op',
        'Content-Type': 'application/json',
      },
      body: credPayload,
    });
    expect(opRes.status).toBe(403);
    expect((await opRes.json()).code).toBe('ROLE_ACCESS_DENIED');

    // 5. Viewer role attempting admin mutation -> 403
    const viewerRes = await app.request('/ops/layer-access/credentials', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a-viewer',
        'Content-Type': 'application/json',
      },
      body: credPayload,
    });
    expect(viewerRes.status).toBe(403);
    expect((await viewerRes.json()).code).toBe('ROLE_ACCESS_DENIED');

    // 6. AI copilot identity attempting admin mutation -> 403
    const aiRes = await app.request('/ops/layer-access/credentials', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a-ai',
        'Content-Type': 'application/json',
      },
      body: credPayload,
    });
    expect(aiRes.status).toBe(403);
    expect((await aiRes.json()).code).toBe('ROLE_ACCESS_DENIED');

    // 7. Tenant B reading Layer Access cannot see Tenant A's submitted credentials
    const readTenantB = await app.request('/ops/layer-access', {
      headers: { Authorization: 'Bearer bearer-tenant-b-admin' },
    });
    expect(readTenantB.status).toBe(200);
    const modelB = LayerAccessReadModelSchema.parse(await readTenantB.json());
    const openskyB = modelB.entries.find((e) => e.id === 'opensky');
    expect(openskyB?.credential.status).toBeNull();
    expect(openskyB?.credential.masked_fingerprint).toBeNull();
  });

  it('redacts private fields and provider secrets with zero plaintext leakage in db, logs, or payloads', async () => {
    const verifier = createVerifier();
    const govContext = createGovernanceRuntimeContext({ clock, dbPath });
    contexts.push(govContext);
    const rawSecret = 'SUPER-SENSITIVE-API-KEY-998877-ABCD';

    let validatorObservedSecret = '';
    const { app } = createApp({
      clock,
      governanceContext: govContext,
      identityBearerVerifier: verifier,
      opsAuth: { requireAuth: true },
      layerAccessCredentialValidator: async (_providerId, secret) => {
        validatorObservedSecret = secret;
        return { valid: false, error: 'Validation failed upstream' };
      },
    });

    // 1. Submit credential with high-entropy secret
    const submitRes = await app.request('/ops/layer-access/credentials', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a-admin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider_id: 'opensky',
        secret_kind: 'api_key',
        secret_value: rawSecret,
      }),
    });
    expect(submitRes.status).toBe(200);
    const submitJson = await submitRes.json();

    // Plaintext secret NOT in HTTP response
    expect(JSON.stringify(submitJson)).not.toContain(rawSecret);
    expect(submitJson.masked_fingerprint).toBe('•••••••• ABCD');

    // 2. Validate credential with failing validator
    const valRes = await app.request('/ops/layer-access/credentials/validate', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a-admin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ provider_id: 'opensky' }),
    });
    expect(valRes.status).toBe(200);
    const valJson = await valRes.json();
    expect(validatorObservedSecret).toBe(rawSecret);
    expect(JSON.stringify(valJson)).not.toContain(rawSecret);
    expect(valJson.validation_error).toBe('Validation failed upstream');

    // 3. Layer Access read projection never returns plaintext secret
    const readRes = await app.request('/ops/layer-access', {
      headers: { Authorization: 'Bearer bearer-tenant-a-admin' },
    });
    expect(readRes.status).toBe(200);
    const readJson = await readRes.text();
    expect(readJson).not.toContain(rawSecret);

    // 4. AuditSink entries never contain plaintext secret
    const auditEntries = govContext.auditSink.tail({ limit: 50 });
    expect(JSON.stringify(auditEntries)).not.toContain(rawSecret);

    // 5. Raw SQLite database files never store plaintext secret
    const inspectionDb = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const dbRows = inspectionDb
        .prepare('SELECT * FROM governance_tenant_layer_credentials WHERE tenant_id = ?')
        .all('tenant-a');
      expect(JSON.stringify(dbRows)).not.toContain(rawSecret);

      const auditRows = inspectionDb.prepare('SELECT * FROM audit_events').all();
      expect(JSON.stringify(auditRows)).not.toContain(rawSecret);
    } finally {
      inspectionDb.close();
    }
  });

  it('deterministically relocks effective access on invalid/revoked/deleted credentials, expired/superseded terms, and STASIS', async () => {
    const verifier = createVerifier();
    const govContext = createGovernanceRuntimeContext({ clock, dbPath });
    contexts.push(govContext);

    let validatorShouldPass = true;
    const liveEnv = {
      GEV_LIVE_MODE: '1',
      GEV_SEED_MODE: '0',
    };
    const liveRegistry = createProviderRegistry({ requestedMode: 'live' });

    const { app } = createApp({
      clock,
      governanceContext: govContext,
      identityBearerVerifier: verifier,
      opsAuth: { requireAuth: true },
      providerRegistry: liveRegistry,
      environment: liveEnv,
      layerAccessAuthorizedLocalState: [
        { provider_id: 'opensky', configuration: { status: 'valid' } },
      ],
      layerAccessCredentialValidator: async () => {
        return validatorShouldPass
          ? { valid: true }
          : { valid: false, error: 'Key expired or invalid' };
      },
    });

    // 1. Initial live state: credentials not configured -> effective access is locked
    const read0 = await app.request('/ops/layer-access', {
      headers: { Authorization: 'Bearer bearer-tenant-a-admin' },
    });
    expect(read0.status).toBe(200);
    const model0 = LayerAccessReadModelSchema.parse(await read0.json());
    const opensky0 = model0.entries.find((e) => e.id === 'opensky');
    expect(opensky0?.effective_access).not.toBe('available');

    // 2. Submit credential & valid terms
    await app.request('/ops/layer-access/credentials', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a-admin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider_id: 'opensky',
        secret_kind: 'api_key',
        secret_value: 'valid-opensky-token-1111',
      }),
    });

    const termsExpiry = new Date(TEST_EPOCH + 100_000).toISOString();
    await app.request('/ops/layer-access/terms', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a-admin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider_id: 'opensky',
        terms_id: 'terms-2026-v1',
        reviewed_url: 'https://opensky-network.org/terms',
        version_digest: 'sha256-opensky-v1',
        approved_use: ['operational_awareness'],
        approved_environments: ['development'],
        expires_at: termsExpiry,
      }),
    });

    // Validate successfully -> becomes 'available'
    await app.request('/ops/layer-access/credentials/validate', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a-admin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ provider_id: 'opensky' }),
    });

    const readUnlocked = await app.request('/ops/layer-access', {
      headers: { Authorization: 'Bearer bearer-tenant-a-admin' },
    });
    const modelUnlocked = LayerAccessReadModelSchema.parse(await readUnlocked.json());
    const openskyUnlocked = modelUnlocked.entries.find((e) => e.id === 'opensky');
    expect(openskyUnlocked?.effective_access).toBe('available');

    // 3. Invalidate credentials -> relocks to setup_required with lock reason
    validatorShouldPass = false;
    await app.request('/ops/layer-access/credentials/validate', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a-admin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ provider_id: 'opensky' }),
    });

    const readInvalid = await app.request('/ops/layer-access', {
      headers: { Authorization: 'Bearer bearer-tenant-a-admin' },
    });
    const modelInvalid = LayerAccessReadModelSchema.parse(await readInvalid.json());
    const openskyInvalid = modelInvalid.entries.find((e) => e.id === 'opensky');
    expect(openskyInvalid?.effective_access).toBe('setup_required');
    expect(openskyInvalid?.lock_reasons.some((r) => r.code === 'credential-invalid')).toBe(true);

    // 4. Revalidate back to valid, then revoke credential -> relocks to setup_required with credential-revoked
    validatorShouldPass = true;
    await app.request('/ops/layer-access/credentials/validate', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a-admin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ provider_id: 'opensky' }),
    });

    await app.request('/ops/layer-access/credentials/revoke', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a-admin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ provider_id: 'opensky', reason: 'Token compromise' }),
    });

    const readRevoked = await app.request('/ops/layer-access', {
      headers: { Authorization: 'Bearer bearer-tenant-a-admin' },
    });
    const modelRevoked = LayerAccessReadModelSchema.parse(await readRevoked.json());
    const openskyRevoked = modelRevoked.entries.find((e) => e.id === 'opensky');
    expect(openskyRevoked?.effective_access).toBe('setup_required');
    expect(openskyRevoked?.lock_reasons.some((r) => r.code === 'credential-revoked')).toBe(true);

    // 5. Delete credential -> relocks
    await app.request('/ops/layer-access/credentials/opensky', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer bearer-tenant-a-admin' },
    });

    const readDeleted = await app.request('/ops/layer-access', {
      headers: { Authorization: 'Bearer bearer-tenant-a-admin' },
    });
    const modelDeleted = LayerAccessReadModelSchema.parse(await readDeleted.json());
    const openskyDeleted = modelDeleted.entries.find((e) => e.id === 'opensky');
    expect(openskyDeleted?.effective_access).toBe('unavailable');

    // 6. Resubmit credential, validate, but revoke terms -> relocks to approval_required with terms-rejected
    await app.request('/ops/layer-access/credentials', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a-admin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider_id: 'opensky',
        secret_kind: 'api_key',
        secret_value: 'new-valid-token-2222',
      }),
    });
    await app.request('/ops/layer-access/credentials/validate', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a-admin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ provider_id: 'opensky' }),
    });

    await app.request('/ops/layer-access/terms/revoke', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a-admin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ provider_id: 'opensky', reason: 'Terms superseded' }),
    });

    const readTermsRevoked = await app.request('/ops/layer-access', {
      headers: { Authorization: 'Bearer bearer-tenant-a-admin' },
    });
    const modelTermsRevoked = LayerAccessReadModelSchema.parse(await readTermsRevoked.json());
    const openskyTermsRevoked = modelTermsRevoked.entries.find((e) => e.id === 'opensky');
    expect(openskyTermsRevoked?.effective_access).toBe('approval_required');
    expect(openskyTermsRevoked?.lock_reasons.some((r) => r.code === 'terms-rejected')).toBe(true);

    // 7. Re-accept terms with near-future expiry, advance clock past expiry -> relocks to approval_required with terms-expired
    await app.request('/ops/layer-access/terms', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-a-admin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider_id: 'opensky',
        terms_id: 'terms-2026-v2',
        reviewed_url: 'https://opensky-network.org/terms',
        version_digest: 'sha256-opensky-v2',
        approved_use: ['operational_awareness'],
        approved_environments: ['development'],
        expires_at: new Date(TEST_EPOCH + 10_000).toISOString(),
      }),
    });

    clock.setTime(TEST_EPOCH + 20_000); // 20s later, past the 10s expiry

    const readTermsExpired = await app.request('/ops/layer-access', {
      headers: { Authorization: 'Bearer bearer-tenant-a-admin' },
    });
    const modelTermsExpired = LayerAccessReadModelSchema.parse(await readTermsExpired.json());
    const openskyTermsExpired = modelTermsExpired.entries.find((e) => e.id === 'opensky');
    expect(openskyTermsExpired?.effective_access).toBe('approval_required');
    expect(openskyTermsExpired?.lock_reasons.some((r) => r.code === 'terms-expired')).toBe(true);

    // 8. Tenant STASIS trip -> all layers relock to 'stasis'
    govContext.budgetLedger.tripTenant('tenant-a', 'BUDGET_BREACH', 'Hard quota breached');

    const readStasis = await app.request('/ops/layer-access', {
      headers: { Authorization: 'Bearer bearer-tenant-a-admin' },
    });
    const modelStasis = LayerAccessReadModelSchema.parse(await readStasis.json());
    expect(modelStasis.entries.every((e) => e.effective_access === 'stasis')).toBe(true);
    expect(modelStasis.entries.every((e) => e.policy.stasis_active)).toBe(true);
    expect(modelStasis.counts.effective.stasis).toBe(modelStasis.entries.length);
  });
});
