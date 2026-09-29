import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AuditIntegrityStatusSchema,
  AuditIntent,
  GevEvents,
  LedgerFingerprintComponentsSchema,
  LedgerOperationSchema,
  M3_FINGERPRINT_VERSION,
  M3_LEDGER_CONTRACT_VERSION,
} from '@gev/contracts';
import {
  AUDIT_REDACTED,
  isSensitiveKey,
  sanitizeAuditIntent,
  sanitizeAuditValue,
} from '../src/auditRedaction.js';
import { canonicalizeJson } from '../src/canonicalJson.js';
import {
  canonicalizeLedgerComponents,
  fingerprintLedgerComponents,
} from '../src/ledgerSerialization.js';

describe('Audit Redaction & Prototype Defense (Round 5: D-01, D-02, D-03)', () => {
  it('prevents prototype pollution and strips forbidden keys (D-01)', () => {
    const maliciousJson =
      '{"__proto__":{"polluted":true},"constructor":{"bad":1},"prototype":{"bad":2},"safe":"ok"}';
    const parsedMalicious = JSON.parse(maliciousJson);

    const intent: AuditIntent = {
      kind: GevEvents.AuditIntent,
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      actor: 'system',
      action: 'feed.fetch.test',
      target: 'test',
      params: parsedMalicious,
      task_ref: 'task-test',
    };

    const sanitized = sanitizeAuditIntent(intent);
    const sanitizedParams = sanitized.params as Record<string, unknown>;

    // 1. Prototype of Object must not be polluted
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    // 2. Forbidden keys must be stripped
    expect('__proto__' in sanitizedParams).toBe(false);
    expect('constructor' in sanitizedParams).toBe(false);
    expect('prototype' in sanitizedParams).toBe(false);
    expect(sanitizedParams.safe).toBe('ok');
  });

  it('preserves shared references in Directed Acyclic Graphs (DAGs) without false cyclic flags (D-02)', () => {
    const sharedChild = { id: 'shared-123', label: 'common-resource' };
    const dagParams = {
      primary: sharedChild,
      secondary: sharedChild,
      nested: {
        again: sharedChild,
      },
    };

    const intent: AuditIntent = {
      kind: GevEvents.AuditIntent,
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      actor: 'system',
      action: 'feed.fetch.test',
      target: 'test',
      params: dagParams,
      task_ref: 'task-test',
    };

    const sanitized = sanitizeAuditIntent(intent);
    const params = sanitized.params as typeof dagParams;

    // Both primary, secondary, and nested.again must contain the object content, NOT '[OMITTED:cyclic-reference]'
    expect(params.primary).toEqual({ id: 'shared-123', label: 'common-resource' });
    expect(params.secondary).toEqual({ id: 'shared-123', label: 'common-resource' });
    expect(params.nested.again).toEqual({ id: 'shared-123', label: 'common-resource' });
  });

  it('detects and omits true recursive cycles on active path without hanging (D-02)', () => {
    const cyclicObj: Record<string, unknown> = { name: 'cyclic-node' };
    cyclicObj.self = cyclicObj;

    const intent: AuditIntent = {
      kind: GevEvents.AuditIntent,
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      actor: 'system',
      action: 'feed.fetch.test',
      target: 'test',
      params: { cyclicObj },
      task_ref: 'task-test',
    };

    const sanitized = sanitizeAuditIntent(intent);
    const params = sanitized.params as { cyclicObj: { name: string; self: unknown } };
    expect(params.cyclicObj.name).toBe('cyclic-node');
    expect(params.cyclicObj.self).toBe('[OMITTED:cyclic-reference]');
  });

  it('redacts sensitive keys including session, jwt, and bearer while preserving non-sensitive keys (D-03)', () => {
    // Sensitive keys that must be redacted
    expect(isSensitiveKey('session')).toBe(true);
    expect(isSensitiveKey('session_id')).toBe(true);
    expect(isSensitiveKey('sessionId')).toBe(true);
    expect(isSensitiveKey('user_jwt')).toBe(true);
    expect(isSensitiveKey('jwtToken')).toBe(true);
    expect(isSensitiveKey('bearer')).toBe(true);
    expect(isSensitiveKey('bearerToken')).toBe(true);
    expect(isSensitiveKey('api_key')).toBe(true);
    expect(isSensitiveKey('secret_token')).toBe(true);
    expect(isSensitiveKey('tax_id')).toBe(true);

    // Non-sensitive keys that should NOT be false-positively redacted
    expect(isSensitiveKey('secretary_name')).toBe(false);
    expect(isSensitiveKey('api_url')).toBe(false);
    expect(isSensitiveKey('api_endpoint')).toBe(false);
    expect(isSensitiveKey('task_ref')).toBe(false);
    expect(isSensitiveKey('provider_status')).toBe(false);

    // Verification via sanitizeAuditIntent
    const intent: AuditIntent = {
      kind: GevEvents.AuditIntent,
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      actor: 'system',
      action: 'feed.fetch.test',
      target: 'test',
      params: {
        session_id: 'sess_secret_123',
        user_jwt: 'eyJhbGciOi...',
        secretary_name: 'Alice Smith',
      },
      task_ref: 'task-test',
    };

    const sanitized = sanitizeAuditIntent(intent);
    const params = sanitized.params as Record<string, unknown>;
    expect(params.session_id).toBe(AUDIT_REDACTED);
    expect(params.user_jwt).toBe(AUDIT_REDACTED);
    expect(params.secretary_name).toBe('Alice Smith');
  });
});

describe('Ledger Serialization & Lossless Fingerprinting (Round 5: D-04, D-08, D-10)', () => {
  const baseComponents = {
    contract_version: M3_LEDGER_CONTRACT_VERSION,
    fingerprint_version: M3_FINGERPRINT_VERSION,
    actor: 'ai' as const,
    tenant_id: 'tenant-alpha',
    action: 'tool.data_query',
    input: { query: 'SELECT 1', limit: 10 },
    task_ref: 'task-5.2',
    is_mutating: false,
    estimate: { currency: 'usd' as const, min: 0, max: 0.05 },
  };

  it('rejects undefined object properties in input to prevent fingerprint collisions (D-04)', () => {
    const invalidComponents = {
      ...baseComponents,
      input: { query: 'SELECT 1', extra: undefined },
    };

    expect(() => canonicalizeLedgerComponents(invalidComponents as any)).toThrow(
      /ledger fingerprint input must be canonically serializable JSON/
    );
  });

  it('rejects functions, symbols, and non-finite numbers in fingerprint input (D-04)', () => {
    expect(() =>
      canonicalizeLedgerComponents({
        ...baseComponents,
        input: { fn: () => {} },
      } as any)
    ).toThrow(/ledger fingerprint input must be canonically serializable JSON/);

    expect(() =>
      canonicalizeLedgerComponents({
        ...baseComponents,
        input: { sym: Symbol('bad') },
      } as any)
    ).toThrow(/ledger fingerprint input must be canonically serializable JSON/);

    expect(() =>
      canonicalizeLedgerComponents({
        ...baseComponents,
        input: { num: Number.NaN },
      } as any)
    ).toThrow(/ledger fingerprint input must be canonically serializable JSON/);

    expect(() =>
      canonicalizeLedgerComponents({
        ...baseComponents,
        input: { num: Number.POSITIVE_INFINITY },
      } as any)
    ).toThrow(/ledger fingerprint input must be canonically serializable JSON/);
  });

  it('produces distinct fingerprints for distinct valid inputs (D-04)', () => {
    const compA = { ...baseComponents, input: { mode: 'full' } };
    const compB = { ...baseComponents, input: { mode: 'diff' } };

    const fpA = fingerprintLedgerComponents(compA);
    const fpB = fingerprintLedgerComponents(compB);

    expect(fpA).toHaveLength(64);
    expect(fpB).toHaveLength(64);
    expect(fpA).not.toBe(fpB);
  });

  it('accepts valid ISO-8601 timestamps with numeric timezone offsets in ledger and audit contracts (D-08)', () => {
    const opId = crypto.randomUUID();
    const validOperationWithOffsets = {
      operation_id: opId,
      intent_id: opId,
      contract_version: M3_LEDGER_CONTRACT_VERSION,
      fingerprint_version: M3_FINGERPRINT_VERSION,
      request_fingerprint: 'a'.repeat(64),
      fingerprint_components: baseComponents,
      state: 'SETTLED' as const,
      reserved_microusd: 50000,
      settled_microusd: 50000,
      period_start: '2026-08-28T12:00:00+00:00',
      deadline_at: '2026-08-28T12:05:00+02:00',
      created_at: '2026-08-28T08:00:00-04:00',
      execution_started_at: '2026-08-28T08:00:01-04:00',
      terminal_at: '2026-08-28T08:00:02-04:00',
      terminal_result: { status: 200 },
      terminal_result_digest: 'b'.repeat(64),
      evidence: null,
    };

    const parsedOp = LedgerOperationSchema.parse(validOperationWithOffsets);
    expect(parsedOp.period_start).toBe('2026-08-28T12:00:00+00:00');
    expect(parsedOp.created_at).toBe('2026-08-28T08:00:00-04:00');

    // Audit integrity status with numeric offset
    const validAuditStatus = {
      status: 'valid' as const,
      chain_version: 'gev.audit.chain.v1',
      schema_version: 1,
      anchor_sequence: 0,
      anchor_hash: '0'.repeat(64),
      head_sequence: 5,
      head_hash: 'f'.repeat(64),
      verified_entries: 5,
      retention_receipts: 0,
      verified_at: '2026-08-28T12:00:00+00:00',
      failure_code: null,
      failure_sequence: null,
    };

    const parsedAudit = AuditIntegrityStatusSchema.parse(validAuditStatus);
    expect(parsedAudit.verified_at).toBe('2026-08-28T12:00:00+00:00');
  });

  it('serializes canonical JSON with sorted keys and compliant number formatting (D-10)', () => {
    const raw = { z: 1, a: 2, m: { y: 'nested', b: true } };
    const serialized = canonicalizeJson(raw as any);

    expect(serialized).toBe('{"a":2,"m":{"b":true,"y":"nested"},"z":1}');
  });
});
