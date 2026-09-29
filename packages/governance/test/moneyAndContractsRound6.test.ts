import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ApprovalResult,
  AuditOutcome,
  CapToken,
  CapTokenClaims,
  GevEvents,
  MAX_SAFE_MICRO_USD,
  ToolManifest,
} from '@gev/contracts';
import { fromMicrousd, toMicrousd } from '../src/money.js';
import { issueSignedCapToken, verifySignedCapToken } from '../src/tadpoleBridge.js';

describe('Money Math & Safe Integer Bounds (Round 6: E-09)', () => {
  const TIERS = [
    { provider: 'flights', costPerFetchUsd: 0.0001, expectedMicrousd: 100 },
    { provider: 'ships', costPerFetchUsd: 0.0005, expectedMicrousd: 500 },
    { provider: 'firms', costPerFetchUsd: 0.001, expectedMicrousd: 1000 },
    { provider: 'cctv', costPerFetchUsd: 0.001, expectedMicrousd: 1000 },
  ];

  it.each(TIERS)(
    'tier $provider ($costPerFetchUsd USD) bills exactly $expectedMicrousd microusd',
    ({ provider, costPerFetchUsd, expectedMicrousd }) => {
      const actual = toMicrousd(costPerFetchUsd, provider, false, 'up');
      expect(actual).toBe(expectedMicrousd);
      expect(fromMicrousd(actual)).toBe(costPerFetchUsd);
    }
  );

  it('enforces MAX_SAFE_MICRO_USD bound on both write and read paths', () => {
    // Write path
    expect(() => toMicrousd(Number.MAX_SAFE_INTEGER, 'test', false, 'up')).toThrow(
      /outside the supported micro-USD range/
    );

    // Read path
    expect(fromMicrousd(MAX_SAFE_MICRO_USD)).toBe(MAX_SAFE_MICRO_USD / 1_000_000);
    expect(() => fromMicrousd(MAX_SAFE_MICRO_USD + 1)).toThrow(/exceeds safe range/);
  });

  it('enforces zero policy and rejects negative values', () => {
    expect(() => toMicrousd(-0.01, 'negative', false, 'up')).toThrow(/finite positive/);
    expect(() => toMicrousd(0, 'zero', false, 'up')).toThrow(/finite positive/);
    expect(toMicrousd(0, 'allowZero', true, 'up')).toBe(0);
  });
});

describe('Capability Tokens & Scope Uniqueness (Round 6: E-04, E-05)', () => {
  it('rejects duplicate scopes in CapTokenClaims (E-05)', () => {
    const invalidClaims = {
      sub: 'ai:copilot-session',
      scopes: ['read.telemetry', 'read.telemetry'],
      iat: '2026-08-28T12:00:00Z',
      exp: '2026-08-28T12:05:00Z',
    };

    expect(() => CapTokenClaims.parse(invalidClaims)).toThrow(
      /capability token scopes must be unique/
    );
  });

  it('rejects empty token in CapToken (E-04)', () => {
    const validClaims = {
      sub: 'ai:copilot-session',
      scopes: ['read.telemetry', 'read.audit'],
      iat: '2026-08-28T12:00:00Z',
      exp: '2026-08-28T12:05:00Z',
    };

    expect(() => CapToken.parse({ token: '', claims: validClaims })).toThrow();
  });

  it('verifies Ed25519 capability tokens from either CapToken object or raw string (E-04)', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const token = issueSignedCapToken(
      'ai:session-1',
      ['read.telemetry', 'operate.cesium'],
      60,
      privateKey
    );

    // 1. Verify passing CapToken object
    const verifiedFromObj = verifySignedCapToken(token, publicKey);
    expect(verifiedFromObj).toEqual(['read.telemetry', 'operate.cesium']);

    // 2. Verify passing raw token string
    const verifiedFromString = verifySignedCapToken(token.token, publicKey);
    expect(verifiedFromString).toEqual(['read.telemetry', 'operate.cesium']);

    // 3. Forged token string fails verification
    const forgedToken = `${token.token}corrupted`;
    expect(verifySignedCapToken(forgedToken, publicKey)).toBeNull();
  });
});

describe('Audit Outcome Error Mandate (Round 6: E-06)', () => {
  it('permits status: ok without an error field', () => {
    const okOutcome = {
      kind: GevEvents.AuditOutcome,
      intent_id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      status: 'ok',
      result: { data: 'success' },
    };

    expect(AuditOutcome.parse(okOutcome).status).toBe('ok');
  });

  it('rejects status: error when error reason is missing or empty', () => {
    const missingError = {
      kind: GevEvents.AuditOutcome,
      intent_id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      status: 'error',
      result: null,
    };

    expect(() => AuditOutcome.parse(missingError)).toThrow(
      /error and blocked outcomes must state a non-empty reason/
    );

    const emptyError = {
      ...missingError,
      error: '   ',
    };

    expect(() => AuditOutcome.parse(emptyError)).toThrow(
      /error and blocked outcomes must state a non-empty reason/
    );
  });

  it('accepts status: error with a valid bounded error reason', () => {
    const validError = {
      kind: GevEvents.AuditOutcome,
      intent_id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      status: 'error',
      error: 'Rate limit exceeded on upstream provider',
    };

    const parsed = AuditOutcome.parse(validError);
    expect(parsed.error).toBe('Rate limit exceeded on upstream provider');
  });

  it('rejects status: blocked when reason is missing', () => {
    const missingBlockedReason = {
      kind: GevEvents.AuditOutcome,
      intent_id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      status: 'blocked',
    };

    expect(() => AuditOutcome.parse(missingBlockedReason)).toThrow(
      /error and blocked outcomes must state a non-empty reason/
    );
  });
});

describe('Tool Manifest & Dangerous Tool Approval Gate (Round 6: E-07)', () => {
  it('rejects tool names with spaces, uppercase, or invalid characters', () => {
    expect(() =>
      ToolManifest.parse({
        name: 'write.flags ',
        description: 'Set flags',
        input_schema: {},
        is_mutating: true,
        is_dangerous: true,
        approval_scopes: ['flags.write'],
      })
    ).toThrow(/tool name must be a lowercase alphanumeric identifier/);

    expect(() =>
      ToolManifest.parse({
        name: 'WRITE_FLAGS',
        description: 'Set flags',
        input_schema: {},
        is_mutating: true,
        is_dangerous: true,
        approval_scopes: ['flags.write'],
      })
    ).toThrow(/tool name must be a lowercase alphanumeric identifier/);
  });

  it('enforces that dangerous tools require approval scopes', () => {
    // Dangerous tool with no approval scopes -> must fail
    expect(() =>
      ToolManifest.parse({
        name: 'write.flags',
        description: 'Set system flags',
        input_schema: {},
        is_mutating: true,
        is_dangerous: true,
        approval_scopes: [],
      })
    ).toThrow(/dangerous tools must require at least one approval scope/);

    // Dangerous tool with approval scopes -> must pass
    const valid = ToolManifest.parse({
      name: 'write.flags',
      description: 'Set system flags',
      input_schema: {},
      is_mutating: true,
      is_dangerous: true,
      approval_scopes: ['flags.write'],
    });
    expect(valid.name).toBe('write.flags');
  });
});

describe('Approval Result Signature Hardening (Round 6: E-08)', () => {
  it('rejects approved decision without a valid non-empty signature', () => {
    expect(() =>
      ApprovalResult.parse({
        request_id: crypto.randomUUID(),
        decision: 'approved',
        signature: 'short',
        decided_by: 'human',
        decided_at: new Date().toISOString(),
      })
    ).toThrow(/approved results require a non-empty cryptographic signature/);

    expect(() =>
      ApprovalResult.parse({
        request_id: crypto.randomUUID(),
        decision: 'approved',
        decided_by: 'human',
        decided_at: new Date().toISOString(),
      })
    ).toThrow();
  });

  it('accepts approved decision with a valid signature (>= 8 chars)', () => {
    const valid = ApprovalResult.parse({
      request_id: crypto.randomUUID(),
      decision: 'approved',
      signature: 'sig-prompt-00000001',
      decided_by: 'human',
      decided_at: new Date().toISOString(),
    });
    expect(valid.signature).toBe('sig-prompt-00000001');
  });

  it('permits denied or expired decision without signature', () => {
    const denied = ApprovalResult.parse({
      request_id: crypto.randomUUID(),
      decision: 'denied',
      decided_by: 'system',
      decided_at: new Date().toISOString(),
    });
    expect(denied.signature).toBeUndefined();
  });
});
