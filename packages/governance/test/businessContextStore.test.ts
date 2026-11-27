import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SteppableClock } from '@gev/core';
import {
  BusinessContextStoreError,
  GOVERNANCE_SCHEMA_VERSION,
  createGovernanceRuntimeContext,
  verifyIndependentAuditChain,
} from '@gev/governance';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];

function makeTempDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-task-13-1-'));
  tempDirs.push(dir);
  return path.join(dir, 'governance.sqlite');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  }
});

const SECRET_BUSINESS_NAME = 'Confidential Quantum Bakery LLC';
const SAMPLE_INPUT = {
  business_name: SECRET_BUSINESS_NAME,
  naics_code: '311811',
  industry_title: 'Retail Bakeries',
  target_geography: {
    level: 'county' as const,
    county_fips: '48453',
    state_fips: '48',
    name: 'Travis County, TX',
  },
  operating_radius_meters: 8000,
  employee_count_estimate: 22,
  annual_revenue_usd_estimate: 4_850_000,
};

describe('Task 13.1 SqliteBusinessContextStore (encrypted, versioned, tenant-isolated)', () => {
  it('encrypts sensitive business parameters at rest, isolates tenants cryptographically, and audits every mutation without leaking PII', () => {
    const dbPath = makeTempDb();
    const key = crypto.randomBytes(32);
    const clock = new SteppableClock(Date.parse('2026-11-27T12:00:00.000Z'));
    const runtime = createGovernanceRuntimeContext({
      dbPath,
      clock,
      credentialEncryptionKey: key,
    });

    try {
      expect(runtime.authority().schema_version).toBe(GOVERNANCE_SCHEMA_VERSION);
      const store = runtime.businessContextStore;

      const v1 = store.createContext(
        'tenant-alpha',
        {
          context_id: 'bakery-hq',
          input: SAMPLE_INPUT,
          retention_days: 90,
          change_reason: 'Initial intake',
        },
        'human',
        'task-13.1-create'
      );
      expect(v1.version).toBe(1);
      expect(v1.encryption_algorithm).toBe('aes-256-gcm');

      // Verify raw SQLite storage has ZERO plaintext sensitive values
      const rawDb = new DatabaseSync(dbPath, { readOnly: true });
      const rawRow = rawDb
        .prepare(
          'SELECT encrypted_payload FROM governance_business_context_versions WHERE tenant_id = ? AND context_id = ? AND version = 1'
        )
        .get('tenant-alpha', 'bakery-hq') as { encrypted_payload: string };
      expect(rawRow.encrypted_payload).toMatch(/^v1:default:/);
      expect(rawRow.encrypted_payload).not.toContain(SECRET_BUSINESS_NAME);
      expect(rawRow.encrypted_payload).not.toContain('4850000');
      rawDb.close();

      // Update with optimistic concurrency
      clock.tick(60_000);
      expect(() =>
        store.updateContext(
          'tenant-alpha',
          'bakery-hq',
          { expected_version: 99, input: SAMPLE_INPUT },
          'human'
        )
      ).toThrow(BusinessContextStoreError);

      const v2 = store.updateContext(
        'tenant-alpha',
        'bakery-hq',
        {
          expected_version: 1,
          input: { ...SAMPLE_INPUT, employee_count_estimate: 30 },
          change_reason: 'Expanded shift',
        },
        'human',
        'task-13.1-update'
      );
      expect(v2.version).toBe(2);
      expect(store.getContext('tenant-alpha', 'bakery-hq', 1)?.input.employee_count_estimate).toBe(
        22
      );
      expect(store.getContext('tenant-alpha', 'bakery-hq', 2)?.input.employee_count_estimate).toBe(
        30
      );

      // Cross-tenant isolation
      expect(store.getContext('tenant-beta', 'bakery-hq')).toBeNull();
      expect(store.listContexts('tenant-beta')).toHaveLength(0);

      // Export & encrypted backup
      const exported = store.exportContext(
        'tenant-alpha',
        'bakery-hq',
        'human',
        'task-13.1-export'
      );
      expect(exported.version_history).toHaveLength(2);
      expect(exported.context.input.business_name).toBe(SECRET_BUSINESS_NAME);

      const backup = store.backupContext('tenant-alpha', 'bakery-hq', 'human', 'task-13.1-backup');
      expect(JSON.stringify(backup)).not.toContain(SECRET_BUSINESS_NAME);
      expect(backup.encrypted_versions).toHaveLength(2);

      // Cross-tenant backup restore fails closed
      expect(() => store.restoreBackup('tenant-beta', backup, 'human')).toThrow(
        /cross-tenant restore denied/i
      );

      // Verified hard deletion leaves zero rows in both parent and version tables
      const receipt = store.deleteContext('tenant-alpha', 'bakery-hq', 'human', 'task-13.1-delete');
      expect(receipt.versions_purged).toBe(2);
      expect(receipt.verified_zero_remaining).toBe(true);
      expect(store.getContext('tenant-alpha', 'bakery-hq')).toBeNull();

      const verifyDb = new DatabaseSync(dbPath, { readOnly: true });
      const leftHeaders = (
        verifyDb.prepare('SELECT COUNT(*) AS c FROM governance_business_contexts').get() as {
          c: number;
        }
      ).c;
      const leftVersions = (
        verifyDb
          .prepare('SELECT COUNT(*) AS c FROM governance_business_context_versions')
          .get() as { c: number }
      ).c;
      expect(leftHeaders).toBe(0);
      expect(leftVersions).toBe(0);
      verifyDb.close();

      // Restore from encrypted backup recovers both versions cleanly
      const restored = store.restoreBackup('tenant-alpha', backup, 'human', 'task-13.1-restore');
      expect(restored.version).toBe(2);
      expect(store.getContext('tenant-alpha', 'bakery-hq', 1)?.input.employee_count_estimate).toBe(
        22
      );
      expect(store.getContext('tenant-alpha', 'bakery-hq', 2)?.input.employee_count_estimate).toBe(
        30
      );

      // Refuses silent clobber of existing context during restore
      expect(() => store.restoreBackup('tenant-alpha', backup, 'human')).toThrow(
        /Refusing to overwrite existing/i
      );

      // Verify M1 audit chain integrity and ZERO sensitive PII in audit entries
      const auditVerification = verifyIndependentAuditChain(runtime.auditSink);
      expect(auditVerification.valid).toBe(true);
      const entries = runtime.auditSink.tail({ limit: 100 });
      expect(JSON.stringify(entries)).not.toContain(SECRET_BUSINESS_NAME);
      expect(JSON.stringify(entries)).not.toContain('4850000');
    } finally {
      runtime.close();
    }
  });

  it('enforces legal hold, retention expiry purge, append-only version trigger, and tamper detection', () => {
    const dbPath = makeTempDb();
    const key = crypto.randomBytes(32);
    const clock = new SteppableClock(Date.parse('2026-11-27T00:00:00.000Z'));
    const runtime = createGovernanceRuntimeContext({
      dbPath,
      clock,
      credentialEncryptionKey: key,
    });

    try {
      const store = runtime.businessContextStore;
      store.createContext(
        'tenant-alpha',
        { context_id: 'short-lived', input: SAMPLE_INPUT, retention_days: 5, legal_hold: false },
        'human'
      );
      store.createContext(
        'tenant-alpha',
        { context_id: 'held-record', input: SAMPLE_INPUT, retention_days: 5, legal_hold: true },
        'human'
      );

      // Legal hold blocks normal delete
      expect(() => store.deleteContext('tenant-alpha', 'held-record', 'human')).toThrow(
        /legal hold/i
      );

      // Advance 6 days -> retention purge removes only non-held expired record
      clock.tick(6 * 86_400_000);
      const purge = store.purgeExpiredContexts('system', 'retention-sweep', 'tenant-alpha');
      expect(purge.purged_count).toBe(1);
      expect(purge.receipts[0]?.context_id).toBe('short-lived');
      expect(store.getContext('tenant-alpha', 'short-lived')).toBeNull();
      expect(store.getContext('tenant-alpha', 'held-record')).not.toBeNull();

      // Append-only SQLite trigger blocks direct UPDATE on version rows
      const rwDb = new DatabaseSync(dbPath);
      expect(() =>
        rwDb
          .prepare(
            "UPDATE governance_business_context_versions SET encrypted_payload = 'tampered' WHERE context_id = 'held-record'"
          )
          .run()
      ).toThrow(/append only/i);

      // Tampering by dropping trigger + altering ciphertext fails decryption closed
      rwDb.exec('DROP TRIGGER governance_business_context_versions_immutable_update;');
      rwDb
        .prepare(
          "UPDATE governance_business_context_versions SET encrypted_payload = 'v1:default:000000000000000000000000:00000000000000000000000000000000:deadbeef' WHERE context_id = 'held-record'"
        )
        .run();
      rwDb.close();

      expect(() => store.getContext('tenant-alpha', 'held-record')).toThrow(
        /ciphertext or tenant AAD verification failed/i
      );

      // Force delete still succeeds with verified zero remaining
      const forced = store.deleteContext('tenant-alpha', 'held-record', 'human', 'admin-override', {
        forceLegalHold: true,
      });
      expect(forced.verified_zero_remaining).toBe(true);
    } finally {
      runtime.close();
    }
  });
});
