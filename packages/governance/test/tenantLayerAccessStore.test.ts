import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { FrozenClock } from '@gev/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeMaskedFingerprint,
  decryptSecret,
  encryptSecret,
} from '../src/layerAccessCrypto.js';
import { openGovernanceDatabase } from '../src/governanceDb.js';
import { SqliteTenantLayerAccessStore } from '../src/tenantLayerAccessStore.js';

describe('Tenant Layer Access Store & Crypto', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: DatabaseSync;
  let clock: FrozenClock;
  const NOW = Date.parse('2026-09-15T21:00:00.000Z');

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-layer-access-test-'));
    dbPath = path.join(tmpDir, 'governance.sqlite');
    clock = new FrozenClock(NOW);
    const opened = openGovernanceDatabase({ dbPath, clock });
    db = opened.db;
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('layerAccessCrypto', () => {
    it('encrypts and decrypts secrets with AES-256-GCM round-trip', () => {
      const secret = 'sk-live-opensky-token-xyz-12345';
      const encrypted = encryptSecret(secret);
      expect(encrypted).not.toContain(secret);
      expect(encrypted.split(':')).toHaveLength(3);

      const decrypted = decryptSecret(encrypted);
      expect(decrypted).toBe(secret);
    });

    it('fails decryption on tampered ciphertext or auth tag', () => {
      const encrypted = encryptSecret('secret-key');
      const [iv, tag, cipher] = encrypted.split(':');
      const tamperedTag = tag.slice(0, -2) + (tag.endsWith('00') ? 'ff' : '00');
      expect(() => decryptSecret(`${iv}:${tamperedTag}:${cipher}`)).toThrow();
    });

    it('computes constant-time masked fingerprint conforming to ADR 0049', () => {
      const fp1 = computeMaskedFingerprint('pk_live_1234567890abcdefA91C');
      expect(fp1).toBe('•••••••• A91C');
      expect(/^\u2022{8} [A-Z0-9]{4}$/.test(fp1)).toBe(true);

      const fpShort = computeMaskedFingerprint('xy');
      expect(/^\u2022{8} [A-Z0-9]{4}$/.test(fpShort)).toBe(true);
    });
  });

  describe('SqliteTenantLayerAccessStore', () => {
    it('submits, validates, rotates, revokes, and deletes credentials with zero plaintext leaks in db', async () => {
      const store = new SqliteTenantLayerAccessStore(db, clock);
      const tenantA = 'tenant-alpha';
      const providerId = 'opensky';

      // 1. Submission
      const submitted = store.submitCredential(
        tenantA,
        {
          provider_id: providerId,
          secret_kind: 'api_key',
          secret_value: 'opensky-client-secret-9999-ABCD',
        },
        'human:admin-1'
      );

      expect(submitted.status).toBe('pending_validation');
      expect(submitted.masked_fingerprint).toBe('•••••••• ABCD');
      expect(submitted.validated_at).toBeNull();

      // Check DB raw row: no plain-text secret anywhere
      const rawRow = db
        .prepare(
          'SELECT * FROM governance_tenant_layer_credentials WHERE tenant_id = ? AND provider_id = ?'
        )
        .get(tenantA, providerId) as { encrypted_secret: string };
      expect(rawRow.encrypted_secret).not.toContain('opensky-client-secret-9999-ABCD');
      expect(JSON.stringify(rawRow)).not.toContain('opensky-client-secret-9999-ABCD');

      // 2. Successful validation
      const validated = await store.validateCredential(tenantA, providerId, async (pId, sec) => {
        expect(pId).toBe(providerId);
        expect(sec).toBe('opensky-client-secret-9999-ABCD');
        return { valid: true };
      });
      expect(validated.status).toBe('valid');
      expect(validated.validated_at).toBe(new Date(NOW).toISOString());

      // 3. Rotation (submitting new secret for same provider)
      clock.setTime(NOW + 10_000);
      const rotated = store.submitCredential(
        tenantA,
        {
          provider_id: providerId,
          secret_kind: 'token',
          secret_value: 'new-rotated-token-EF01',
        },
        'human:admin-1'
      );
      expect(rotated.status).toBe('pending_validation');
      expect(rotated.masked_fingerprint).toBe('•••••••• EF01');
      expect(rotated.validated_at).toBeNull();
      expect(store.getDecryptedSecret(tenantA, providerId)).toBeNull(); // Pending credentials are not usable for queries

      // 4. Failed validation
      const failedValidation = await store.validateCredential(tenantA, providerId, async () => {
        return { valid: false, error: 'Invalid API key credentials' };
      });
      expect(failedValidation.status).toBe('invalid');
      expect(failedValidation.validation_error).toBe('Invalid API key credentials');

      // 5. Revocation
      clock.setTime(NOW + 15_000);
      const revoked = store.revokeCredential(
        tenantA,
        providerId,
        'Key compromised',
        'human:admin-1'
      );
      expect(revoked.status).toBe('revoked');
      expect(revoked.revoked_at).not.toBeNull();
      expect(store.getDecryptedSecret(tenantA, providerId)).toBeNull();

      // 6. Deletion
      const deleted = store.deleteCredential(tenantA, providerId, 'human:admin-1');
      expect(deleted).toBe(true);
      expect(store.getCredentialRecord(tenantA, providerId)).toBeNull();
    });

    it('enforces bounded validation timeout <= 5s', async () => {
      const store = new SqliteTenantLayerAccessStore(db, clock);
      store.submitCredential(
        'tenant-beta',
        {
          provider_id: 'aisstream',
          secret_kind: 'api_key',
          secret_value: 'aisstream-secret-key-1234',
        },
        'human:admin-1'
      );

      // Validator that hangs longer than bounded timeout
      const result = await store.validateCredential(
        'tenant-beta',
        'aisstream',
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return { valid: true };
        },
        { timeoutMs: 50 }
      );

      expect(result.status).toBe('invalid');
      expect(result.validation_error).toMatch(/bounded timeout/i);
    });

    it('tracks versioned terms acceptance and detects expiry', () => {
      const store = new SqliteTenantLayerAccessStore(db, clock);
      const tenant = 'tenant-gamma';
      const providerId = 'celestrak';

      const accepted = store.acceptTerms(
        tenant,
        {
          provider_id: providerId,
          terms_id: 'celestrak-terms-v2',
          reviewed_url: 'https://celestrak.org/NORAD/documentation/gp-data-formats.php',
          version_digest: 'sha256-abc12345',
          approved_use: ['operational_awareness', 'internal_evaluation'],
          approved_environments: ['development', 'staging'],
          expires_at: new Date(NOW + 30_000).toISOString(),
        },
        'human:legal-approver'
      );

      expect(accepted.status).toBe('approved');
      expect(accepted.approved_by).toBe('human:legal-approver');

      // Runtime inputs before expiry
      let inputs = store.getTenantRuntimeInputs(tenant);
      const entry = inputs.find((i) => i.provider_id === providerId);
      expect(entry?.terms?.status).toBe('approved');

      // Advance clock past expiry
      clock.setTime(NOW + 40_000);
      inputs = store.getTenantRuntimeInputs(tenant);
      const expiredEntry = inputs.find((i) => i.provider_id === providerId);
      expect(expiredEntry?.terms?.status).toBe('expired');

      // Revoking terms
      store.revokeTerms(tenant, providerId, 'Licensing terms updated', 'human:admin');
      inputs = store.getTenantRuntimeInputs(tenant);
      const revokedEntry = inputs.find((i) => i.provider_id === providerId);
      expect(revokedEntry?.terms?.status).toBe('rejected');
    });

    it('strictly isolates tenant credentials and terms', () => {
      const store = new SqliteTenantLayerAccessStore(db, clock);
      store.submitCredential(
        'tenant-one',
        {
          provider_id: 'opensky',
          secret_kind: 'api_key',
          secret_value: 'tenant-one-secret-AAAA',
        },
        'human:admin-1'
      );

      store.submitCredential(
        'tenant-two',
        {
          provider_id: 'opensky',
          secret_kind: 'api_key',
          secret_value: 'tenant-two-secret-BBBB',
        },
        'human:admin-2'
      );

      const oneCred = store.getCredentialRecord('tenant-one', 'opensky');
      const twoCred = store.getCredentialRecord('tenant-two', 'opensky');

      expect(oneCred?.masked_fingerprint).toBe('•••••••• AAAA');
      expect(twoCred?.masked_fingerprint).toBe('•••••••• BBBB');

      // Deleting in tenant-one does not affect tenant-two
      store.deleteCredential('tenant-one', 'opensky', 'human:admin-1');
      expect(store.getCredentialRecord('tenant-one', 'opensky')).toBeNull();
      expect(store.getCredentialRecord('tenant-two', 'opensky')).not.toBeNull();
    });
  });
});
