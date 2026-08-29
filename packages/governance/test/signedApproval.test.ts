import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  ApprovalProviderResponse,
  ApprovalRequest,
  SignedApprovalEnvelope,
  SignedApprovalPayload,
} from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PromptApprovalGate } from '../src/approvalGate.js';
import { createGovernanceRuntimeContext } from '../src/runtimeContext.js';
import {
  InMemoryApprovalNonceStore,
  LocalM2ApprovalDemoGate,
  LocalSignedApprovalProvider,
  SignedApprovalGate,
  type SignedApprovalProvider,
  type TadpoleKeyPair,
  type TrustedApprovalKey,
  canonicalizeSignedApprovalPayload,
  generateEd25519KeyPair,
  signApprovalPayload,
  verifySignedApprovalEnvelope,
} from '../src/signedApproval.js';

const NOW = 1_700_000_000_000;
const tempDirectories: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function approvalRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    ts: new Date(NOW).toISOString(),
    intent_id: '00000000-0000-4000-8000-000000000002',
    scopes: ['flags.write', 'spend.external'],
    nonce: '00000000-0000-4000-8000-000000000003',
    rationale: 'Approve a governed mutating test action',
    expires_at: new Date(NOW + 60_000).toISOString(),
    ...overrides,
  };
}

function signedPayload(
  request: ApprovalRequest,
  overrides: Partial<SignedApprovalPayload> = {}
): SignedApprovalPayload {
  return {
    format: 'gev.m2.approval.v1',
    request_id: request.id,
    intent_id: request.intent_id,
    decision: 'approved',
    scopes: [...request.scopes].sort(),
    signer_id: 'human:test-operator',
    key_id: 'test-key-2026-01',
    nonce: request.nonce,
    issued_at: request.ts,
    decided_by: 'human',
    decided_at: request.ts,
    expires_at: request.expires_at,
    ...overrides,
  };
}

class EnvelopeProvider implements SignedApprovalProvider {
  constructor(private readonly response: ApprovalProviderResponse | (() => never)) {}

  async decide(): Promise<ApprovalProviderResponse> {
    return typeof this.response === 'function' ? this.response() : this.response;
  }
}

function trustedKey(keyPair: TadpoleKeyPair, overrides: Partial<TrustedApprovalKey> = {}) {
  return {
    signerId: 'human:test-operator',
    keyId: 'test-key-2026-01',
    publicKeyPem: keyPair.publicKeyPem,
    status: 'active' as const,
    ...overrides,
  };
}

function gateForEnvelope(
  envelope: SignedApprovalEnvelope,
  key: TrustedApprovalKey,
  clock = new FrozenClock(NOW)
): SignedApprovalGate {
  return new SignedApprovalGate({
    clock,
    trustedKeys: [key],
    nonceStore: new InMemoryApprovalNonceStore(),
    provider: new EnvelopeProvider({ decision: 'approved', signed_approval: envelope }),
  });
}

describe('M2 signed approval verification', () => {
  it('canonicalizes, signs, and verifies the complete versioned approval payload', async () => {
    const clock = new FrozenClock(NOW);
    const request = approvalRequest();
    const keyPair = generateEd25519KeyPair();
    const payload = signedPayload(request);
    const differentlyOrdered = {
      expires_at: payload.expires_at,
      decided_at: payload.decided_at,
      decided_by: payload.decided_by,
      issued_at: payload.issued_at,
      nonce: payload.nonce,
      key_id: payload.key_id,
      signer_id: payload.signer_id,
      scopes: payload.scopes,
      decision: payload.decision,
      intent_id: payload.intent_id,
      request_id: payload.request_id,
      format: payload.format,
    };

    expect(canonicalizeSignedApprovalPayload(differentlyOrdered)).toBe(
      canonicalizeSignedApprovalPayload(payload)
    );
    const envelope = signApprovalPayload(payload, keyPair.privateKeyPem);
    expect(verifySignedApprovalEnvelope(envelope, keyPair.publicKeyPem)).toBe(true);

    const gate = gateForEnvelope(envelope, trustedKey(keyPair), clock);
    await expect(gate.request(request)).resolves.toMatchObject({
      decision: 'approved',
      request_id: request.id,
      decided_by: 'human',
    });
  });

  it.each([
    ['intent', { intent_id: '00000000-0000-4000-8000-000000000099' }],
    ['nonce', { nonce: '00000000-0000-4000-8000-000000000099' }],
    ['expiry', { expires_at: new Date(NOW + 59_000).toISOString() }],
    ['scope', { scopes: ['repo.write'] }],
  ] as const)('rejects a correctly signed approval for the wrong %s', async (_label, change) => {
    const request = approvalRequest();
    const keyPair = generateEd25519KeyPair();
    const envelope = signApprovalPayload(signedPayload(request, change), keyPair.privateKeyPem);
    const gate = gateForEnvelope(envelope, trustedKey(keyPair));
    await expect(gate.request(request)).rejects.toThrow(/does not|scopes/);
  });

  it('rejects post-signature tampering and a signature from the wrong key', async () => {
    const request = approvalRequest();
    const trusted = generateEd25519KeyPair();
    const attacker = generateEd25519KeyPair();
    const valid = signApprovalPayload(signedPayload(request), trusted.privateKeyPem);
    const tampered = {
      ...valid,
      payload: { ...valid.payload, issued_at: new Date(NOW + 1_000).toISOString() },
    };
    await expect(gateForEnvelope(tampered, trustedKey(trusted)).request(request)).rejects.toThrow(
      /signature verification failed/
    );

    const wrongSignature = signApprovalPayload(signedPayload(request), attacker.privateKeyPem);
    await expect(
      gateForEnvelope(wrongSignature, trustedKey(trusted)).request(request)
    ).rejects.toThrow(/signature verification failed/);
  });

  it('rejects unknown signer/key identities and revoked or out-of-window keys', async () => {
    const request = approvalRequest();
    const keyPair = generateEd25519KeyPair();
    const unknown = signApprovalPayload(
      signedPayload(request, { signer_id: 'human:unknown' }),
      keyPair.privateKeyPem
    );
    await expect(gateForEnvelope(unknown, trustedKey(keyPair)).request(request)).rejects.toThrow(
      /untrusted signer or key/
    );

    const envelope = signApprovalPayload(signedPayload(request), keyPair.privateKeyPem);
    await expect(
      gateForEnvelope(envelope, trustedKey(keyPair, { status: 'revoked' })).request(request)
    ).rejects.toThrow(/revoked key/);
    await expect(
      gateForEnvelope(
        envelope,
        trustedKey(keyPair, {
          status: 'retired',
          validUntil: new Date(NOW).toISOString(),
        })
      ).request(request)
    ).rejects.toThrow(/postdates the trusted key validity window/);
  });

  it('accepts a still-live approval decided before a retired key boundary', async () => {
    const request = approvalRequest();
    const keyPair = generateEd25519KeyPair();
    const envelope = signApprovalPayload(signedPayload(request), keyPair.privateKeyPem);
    const gate = gateForEnvelope(
      envelope,
      trustedKey(keyPair, {
        status: 'retired',
        validUntil: new Date(NOW + 1_000).toISOString(),
      })
    );
    await expect(gate.request(request)).resolves.toMatchObject({ decision: 'approved' });
  });

  it('rejects stale, overlong, future-dated, and internally reversed time windows', async () => {
    const keyPair = generateEd25519KeyPair();
    const expiredRequest = approvalRequest();
    const expiredClock = new FrozenClock(NOW + 60_000);
    const unusedProvider = new EnvelopeProvider(() => {
      throw new Error('expired request must not reach provider');
    });
    const expiredGate = new SignedApprovalGate({
      clock: expiredClock,
      trustedKeys: [trustedKey(keyPair)],
      nonceStore: new InMemoryApprovalNonceStore(),
      provider: unusedProvider,
    });
    await expect(expiredGate.request(expiredRequest)).resolves.toMatchObject({
      decision: 'expired',
    });

    const overlong = approvalRequest({ expires_at: new Date(NOW + 60_001).toISOString() });
    await expect(expiredGate.request(overlong)).rejects.toThrow(/lifetime exceeds/);

    const futureRequest = approvalRequest();
    const futureEnvelope = signApprovalPayload(
      signedPayload(futureRequest, {
        decided_at: new Date(NOW + 5_001).toISOString(),
        issued_at: new Date(NOW + 5_001).toISOString(),
      }),
      keyPair.privateKeyPem
    );
    await expect(
      gateForEnvelope(futureEnvelope, trustedKey(keyPair)).request(futureRequest)
    ).rejects.toThrow(/future decision or issuance/);

    const reversedEnvelope = signApprovalPayload(
      signedPayload(futureRequest, {
        decided_at: new Date(NOW + 1_000).toISOString(),
        issued_at: new Date(NOW).toISOString(),
      }),
      keyPair.privateKeyPem
    );
    await expect(
      gateForEnvelope(reversedEnvelope, trustedKey(keyPair)).request(futureRequest)
    ).rejects.toThrow(/issued before its human decision/);
  });

  it('consumes nonce/request pairs atomically across two SQLite connections', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-approval-replay-'));
    tempDirectories.push(directory);
    const dbPath = path.join(directory, 'governance.sqlite');
    const clock = new FrozenClock(NOW);
    const request = approvalRequest();
    const keyPair = generateEd25519KeyPair();
    const provider = new LocalSignedApprovalProvider({
      signerId: 'human:test-operator',
      keyId: 'test-key-2026-01',
      privateKeyPem: keyPair.privateKeyPem,
      policy: 'approve_all',
      clock,
    });
    const makeRuntime = () =>
      createGovernanceRuntimeContext({
        dbPath,
        clock,
        signedApproval: {
          provider,
          trustedKeys: [trustedKey(keyPair)],
        },
      });
    const first = makeRuntime();
    const second = makeRuntime();

    const results = await Promise.allSettled([
      first.approvalGate.request(request),
      second.approvalGate.request(request),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    expect(rejected?.reason).toBeInstanceOf(Error);
    expect((rejected?.reason as Error).message).toMatch(/replay detected/);
    first.close();
    second.close();
  });

  it('fails closed when the provider is unavailable', async () => {
    const keyPair = generateEd25519KeyPair();
    const gate = new SignedApprovalGate({
      clock: new FrozenClock(NOW),
      trustedKeys: [trustedKey(keyPair)],
      nonceStore: new InMemoryApprovalNonceStore(),
      provider: new EnvelopeProvider(() => {
        throw new Error('approval service offline');
      }),
    });
    await expect(gate.request(approvalRequest())).rejects.toThrow(/provider unavailable/);
  });

  it('uses a deny-only production default and forbids local permissive signers', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const clock = new FrozenClock(NOW);
    const runtime = createGovernanceRuntimeContext({ dbPath: ':memory:', clock });
    await expect(runtime.approvalGate.request(approvalRequest())).resolves.toMatchObject({
      decision: 'denied',
      decided_by: 'system',
    });
    expect(() => new PromptApprovalGate({ policy: 'auto', clock })).toThrow(/forbidden/);
    const keyPair = generateEd25519KeyPair();
    expect(
      () =>
        new LocalSignedApprovalProvider({
          signerId: 'human:test-operator',
          keyId: 'test-key-2026-01',
          privateKeyPem: keyPair.privateKeyPem,
          policy: 'approve_all',
          clock,
        })
    ).toThrow(/forbidden in production/);
    runtime.close();
  });

  it('keeps the local auto-signing gate explicitly demo-only', async () => {
    const gate = new LocalM2ApprovalDemoGate({ clock: new FrozenClock(NOW) });
    await expect(gate.request(approvalRequest())).resolves.toMatchObject({
      decision: 'approved',
      decided_by: 'human',
    });
  });
});
