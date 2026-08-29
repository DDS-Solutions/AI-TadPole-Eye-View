import { describe, expect, it } from 'vitest';
import { AUDIT_CHAIN_VERSION, AuditIntegrityStatusSchema } from '../src/auditIntegrity.js';

const HASH = 'a'.repeat(64);

describe('audit integrity contracts', () => {
  it('validates a bounded valid chain status', () => {
    expect(
      AuditIntegrityStatusSchema.parse({
        status: 'valid',
        chain_version: AUDIT_CHAIN_VERSION,
        schema_version: 4,
        anchor_sequence: 0,
        anchor_hash: HASH,
        head_sequence: 12,
        head_hash: HASH,
        verified_entries: 12,
        retention_receipts: 0,
        verified_at: '2026-08-29T12:00:00.000Z',
        failure_code: null,
        failure_sequence: null,
      }).status
    ).toBe('valid');
  });

  it('rejects contradictory or unversioned valid claims', () => {
    expect(() =>
      AuditIntegrityStatusSchema.parse({
        status: 'valid',
        chain_version: 'unknown',
        schema_version: 4,
        anchor_sequence: 0,
        anchor_hash: HASH,
        head_sequence: 0,
        head_hash: HASH,
        verified_entries: 0,
        retention_receipts: 0,
        verified_at: '2026-08-29T12:00:00.000Z',
        failure_code: 'HEAD_MISMATCH',
        failure_sequence: null,
      })
    ).toThrow();
  });
});
