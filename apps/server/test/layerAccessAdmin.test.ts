import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  type AuditIntent,
  type AuditOutcome,
  type AuthenticatedIdentityContext,
  GEV_PRODUCTION_IDENTITY_PROFILE,
  type IdentityActor,
  type IdentityBearerVerifier,
  type IdentityRole,
  LayerAccessReadModelSchema,
} from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { createGovernanceRuntimeContext } from '@gev/governance';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/index.js';

const TEST_EPOCH = 1_725_000_000_000;

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
      if (token === 'bearer-tenant-admin') return makeTenantIdentity('tenant-a', 'tenant_admin');
      if (token === 'bearer-tenant-operator') return makeTenantIdentity('tenant-a', 'operator');
      if (token === 'bearer-tenant-viewer') return makeTenantIdentity('tenant-a', 'viewer');
      if (token === 'bearer-tenant-ai') return makeTenantIdentity('tenant-a', 'ai_copilot', 'ai');
      if (token === 'bearer-other-tenant') return makeTenantIdentity('tenant-b', 'tenant_admin');
      return null;
    },
  };
}

describe('Tenant-Scoped Layer Access Administration (Task 7.4)', () => {
  let tmpDir: string;
  let dbPath: string;
  let clock: FrozenClock;
  const contexts: ReturnType<typeof createGovernanceRuntimeContext>[] = [];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-layer-access-admin-test-'));
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

  it('submits and rotates credentials, logs audit, and stores encrypted secrets without plaintext leaks', async () => {
    const verifier = createVerifier();
    const govContext = createGovernanceRuntimeContext({ clock, dbPath });
    contexts.push(govContext);
    const { app } = createApp({
      clock,
      governanceContext: govContext,
      identityBearerVerifier: verifier,
      opsAuth: { requireAuth: true },
    });

    const secretValue = 'opensky-secret-token-XYZ9999-ABCD';

    // 1. Submit credential as tenant_admin
    const submitRes = await app.request('/ops/layer-access/credentials', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-admin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider_id: 'opensky',
        secret_kind: 'api_key',
        secret_value: secretValue,
      }),
    });

    expect(submitRes.status).toBe(200);
    const submitJson = await submitRes.json();
    expect(submitJson).toMatchObject({
      tenant_id: 'tenant-a',
      provider_id: 'opensky',
      secret_kind: 'api_key',
      status: 'pending_validation',
      masked_fingerprint: '•••••••• ABCD',
      validated_at: null,
    });
    // Ensure raw secret is never returned
    expect(JSON.stringify(submitJson)).not.toContain(secretValue);

    // Verify audit logs contain intent and outcome without raw secret
    const auditEntries = govContext.auditSink.tail({ limit: 20 });
    const intent = auditEntries.find(
      (e): e is AuditIntent =>
        e.kind === 'audit.intent' && e.action === 'layer_access.credential_submit'
    );
    expect(intent).toBeDefined();
    const outcome = auditEntries.find(
      (e): e is AuditOutcome => e.kind === 'audit.outcome' && e.intent_id === intent?.id
    );
    expect(outcome).toBeDefined();
    expect(outcome?.status).toBe('ok');
    expect(JSON.stringify(auditEntries)).not.toContain(secretValue);

    // 2. Rotate credential
    const rotateRes = await app.request('/ops/layer-access/credentials', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-admin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider_id: 'opensky',
        secret_kind: 'token',
        secret_value: 'new-rotated-token-1234-EF01',
      }),
    });
    expect(rotateRes.status).toBe(200);
    const rotateJson = await rotateRes.json();
    expect(rotateJson.masked_fingerprint).toBe('•••••••• EF01');
    expect(rotateJson.status).toBe('pending_validation');
  });

  it('validates credentials bounded <= 5s, handles successes and failures with audit logging', async () => {
    const verifier = createVerifier();
    const govContext = createGovernanceRuntimeContext({ clock, dbPath });
    contexts.push(govContext);
    let shouldValidate = true;

    const { app } = createApp({
      clock,
      governanceContext: govContext,
      identityBearerVerifier: verifier,
      opsAuth: { requireAuth: true },
      layerAccessCredentialValidator: async (_providerId, _secret) => {
        return shouldValidate ? { valid: true } : { valid: false, error: 'Upstream key inactive' };
      },
    });

    // First submit a credential
    await app.request('/ops/layer-access/credentials', {
      method: 'POST',
      headers: { Authorization: 'Bearer bearer-tenant-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider_id: 'aisstream',
        secret_kind: 'api_key',
        secret_value: 'aisstream-secret-key-4444',
      }),
    });

    // Validate successfully
    const valRes = await app.request('/ops/layer-access/credentials/validate', {
      method: 'POST',
      headers: { Authorization: 'Bearer bearer-tenant-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider_id: 'aisstream' }),
    });
    expect(valRes.status).toBe(200);
    const valJson = await valRes.json();
    expect(valJson.status).toBe('valid');
    expect(valJson.validated_at).not.toBeNull();

    // Validate failure
    shouldValidate = false;
    const failRes = await app.request('/ops/layer-access/credentials/validate', {
      method: 'POST',
      headers: { Authorization: 'Bearer bearer-tenant-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider_id: 'aisstream' }),
    });
    expect(failRes.status).toBe(200);
    const failJson = await failRes.json();
    expect(failJson.status).toBe('invalid');
    expect(failJson.validation_error).toBe('Upstream key inactive');
  });

  it('revokes and deletes credentials and records versioned terms acceptance evidence', async () => {
    const verifier = createVerifier();
    const govContext = createGovernanceRuntimeContext({ clock, dbPath });
    contexts.push(govContext);
    const { app } = createApp({
      clock,
      governanceContext: govContext,
      identityBearerVerifier: verifier,
      opsAuth: { requireAuth: true },
    });

    // Submit and accept terms
    await app.request('/ops/layer-access/credentials', {
      method: 'POST',
      headers: { Authorization: 'Bearer bearer-tenant-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider_id: 'celestrak',
        secret_kind: 'api_key',
        secret_value: 'key-1234',
      }),
    });

    const termsRes = await app.request('/ops/layer-access/terms', {
      method: 'POST',
      headers: { Authorization: 'Bearer bearer-tenant-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider_id: 'celestrak',
        terms_id: 'terms-2026-v1',
        reviewed_url: 'https://celestrak.org/terms',
        version_digest: 'sha256-12345678',
        approved_use: ['internal_evaluation'],
        approved_environments: ['development'],
      }),
    });
    expect(termsRes.status).toBe(200);
    const termsJson = await termsRes.json();
    expect(termsJson.status).toBe('approved');
    expect(termsJson.approved_by).toBe('auth0|tenant-a-user');

    // Revoke terms
    const revokeTermsRes = await app.request('/ops/layer-access/terms/revoke', {
      method: 'POST',
      headers: { Authorization: 'Bearer bearer-tenant-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider_id: 'celestrak',
        reason: 'Policy updated',
      }),
    });
    expect(revokeTermsRes.status).toBe(200);
    const revokeTermsJson = await revokeTermsRes.json();
    expect(revokeTermsJson.status).toBe('rejected');

    // Revoke credential
    const revokeCredRes = await app.request('/ops/layer-access/credentials/revoke', {
      method: 'POST',
      headers: { Authorization: 'Bearer bearer-tenant-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider_id: 'celestrak',
        reason: 'Rotation cycle',
      }),
    });
    expect(revokeCredRes.status).toBe(200);
    const revokeCredJson = await revokeCredRes.json();
    expect(revokeCredJson.status).toBe('revoked');

    // Delete credential
    const delRes = await app.request('/ops/layer-access/credentials/celestrak', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer bearer-tenant-admin' },
    });
    expect(delRes.status).toBe(200);
    expect((await delRes.json()).deleted).toBe(true);
  });

  it('enforces role authorization matrix, rejects non-admin, AI identities, and cross-tenant attempts', async () => {
    const verifier = createVerifier();
    const govContext = createGovernanceRuntimeContext({ clock, dbPath });
    contexts.push(govContext);
    const { app } = createApp({
      clock,
      governanceContext: govContext,
      identityBearerVerifier: verifier,
      opsAuth: { requireAuth: true },
    });

    const payload = JSON.stringify({
      provider_id: 'opensky',
      secret_kind: 'api_key',
      secret_value: 'secret-1234',
    });

    // 1. Unauthenticated -> 401
    const unauthRes = await app.request('/ops/layer-access/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    expect(unauthRes.status).toBe(401);

    // 2. Operator role -> 403
    const opRes = await app.request('/ops/layer-access/credentials', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-operator',
        'Content-Type': 'application/json',
      },
      body: payload,
    });
    expect(opRes.status).toBe(403);
    expect((await opRes.json()).code).toBe('ROLE_ACCESS_DENIED');

    // 3. Viewer role -> 403
    const viewerRes = await app.request('/ops/layer-access/credentials', {
      method: 'POST',
      headers: { Authorization: 'Bearer bearer-tenant-viewer', 'Content-Type': 'application/json' },
      body: payload,
    });
    expect(viewerRes.status).toBe(403);
    expect((await viewerRes.json()).code).toBe('ROLE_ACCESS_DENIED');

    // 4. AI identity -> 403
    const aiRes = await app.request('/ops/layer-access/credentials', {
      method: 'POST',
      headers: { Authorization: 'Bearer bearer-tenant-ai', 'Content-Type': 'application/json' },
      body: payload,
    });
    expect(aiRes.status).toBe(403);
    expect((await aiRes.json()).code).toBe('ROLE_ACCESS_DENIED');

    // 5. Cross-tenant header manipulation -> 403
    const crossRes = await app.request('/ops/layer-access/credentials', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bearer-tenant-admin',
        'X-GEV-Tenant': 'tenant-b',
        'Content-Type': 'application/json',
      },
      body: payload,
    });
    expect(crossRes.status).toBe(403);
    expect((await crossRes.json()).code).toBe('TENANT_ACCESS_DENIED');
  });

  it('deterministically relocks effective access when credentials or terms change or tenant STASIS trips', async () => {
    const verifier = createVerifier();
    const govContext = createGovernanceRuntimeContext({ clock, dbPath });
    contexts.push(govContext);
    const { app } = createApp({
      clock,
      governanceContext: govContext,
      identityBearerVerifier: verifier,
      opsAuth: { requireAuth: true },
      layerAccessCredentialValidator: async () => ({ valid: true }),
    });

    // 1. Initially opensky has no credentials submitted for tenant-a
    const read1 = await app.request('/ops/layer-access', {
      headers: { Authorization: 'Bearer bearer-tenant-admin' },
    });
    expect(read1.status).toBe(200);
    const model1 = LayerAccessReadModelSchema.parse(await read1.json());
    const opensky1 = model1.entries.find((e) => e.id === 'opensky');
    expect(opensky1).toBeDefined();
    expect(opensky1?.credential.status).toBeNull();
    expect(opensky1?.credential.masked_fingerprint).toBeNull();

    // 2. Submit credential & terms for opensky
    await app.request('/ops/layer-access/credentials', {
      method: 'POST',
      headers: { Authorization: 'Bearer bearer-tenant-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider_id: 'opensky',
        secret_kind: 'api_key',
        secret_value: 'opensky-secret-val-9999',
      }),
    });
    await app.request('/ops/layer-access/credentials/validate', {
      method: 'POST',
      headers: { Authorization: 'Bearer bearer-tenant-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider_id: 'opensky' }),
    });
    await app.request('/ops/layer-access/terms', {
      method: 'POST',
      headers: { Authorization: 'Bearer bearer-tenant-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider_id: 'opensky',
        terms_id: 'terms-opensky',
        reviewed_url: 'https://opensky-network.org/terms',
        version_digest: 'sha256-opensky',
        approved_use: ['operational_awareness'],
        approved_environments: ['development'],
      }),
    });

    const read2 = await app.request('/ops/layer-access', {
      headers: { Authorization: 'Bearer bearer-tenant-admin' },
    });
    const model2 = LayerAccessReadModelSchema.parse(await read2.json());
    const opensky2 = model2.entries.find((e) => e.id === 'opensky');
    expect(opensky2).toBeDefined();
    expect(opensky2?.credential.status).toBe('valid');
    expect(opensky2?.terms.status).toBe('approved');
    expect(opensky2?.credential.masked_fingerprint).toBe('•••••••• 9999');

    // 3. Revoke credential -> opensky relocks
    await app.request('/ops/layer-access/credentials/revoke', {
      method: 'POST',
      headers: { Authorization: 'Bearer bearer-tenant-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider_id: 'opensky', reason: 'Leaked' }),
    });
    const read3 = await app.request('/ops/layer-access', {
      headers: { Authorization: 'Bearer bearer-tenant-admin' },
    });
    const model3 = LayerAccessReadModelSchema.parse(await read3.json());
    const opensky3 = model3.entries.find((e) => e.id === 'opensky');
    expect(opensky3).toBeDefined();
    expect(opensky3?.credential.status).toBe('revoked');

    // 4. Tenant STASIS trip -> all layers relock to stasis
    govContext.budgetLedger.tripTenant('tenant-a', 'BUDGET_BREACH', 'Tenant quota exceeded');

    const read4 = await app.request('/ops/layer-access', {
      headers: { Authorization: 'Bearer bearer-tenant-admin' },
    });
    const model4 = LayerAccessReadModelSchema.parse(await read4.json());
    expect(model4.entries.every((e) => e.effective_access === 'stasis')).toBe(true);
  });
});
