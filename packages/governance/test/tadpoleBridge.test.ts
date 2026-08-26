import crypto from 'node:crypto';
import { FrozenClock } from '@gev/core';
import { describe, expect, it } from 'vitest';
import {
  MerkleAuditChain,
  TadpoleM2Gatekeeper,
  generateEd25519KeyPair,
  issueSignedCapToken,
  signApprovalResult,
  verifyApprovalSignature,
  verifySignedCapToken,
} from '../src/tadpoleBridge.js';

describe('Tadpole M2 Integration Spike & Cryptographic Governance (PLAN.md §6 & §10)', () => {
  it('generates valid Ed25519 keypair and creates verifiable cryptographic signatures', () => {
    const keyPair = generateEd25519KeyPair();
    expect(keyPair.publicKeyPem).toContain('BEGIN PUBLIC KEY');
    expect(keyPair.privateKeyPem).toContain('BEGIN PRIVATE KEY');

    const rawResult = {
      request_id: crypto.randomUUID(),
      decision: 'approved' as const,
      decided_by: 'human' as const,
      decided_at: new Date().toISOString(),
    };

    const signature = signApprovalResult(rawResult, keyPair.privateKeyPem);
    expect(signature).toBeDefined();
    expect(typeof signature).toBe('string');

    // 1. Verify valid signature with matching public key
    const isValid = verifyApprovalSignature({ ...rawResult, signature }, keyPair.publicKeyPem);
    expect(isValid).toBe(true);

    // 2. Reject tampered payload (e.g. changed decision)
    const isTamperedValid = verifyApprovalSignature(
      { ...rawResult, decision: 'denied', signature },
      keyPair.publicKeyPem
    );
    expect(isTamperedValid).toBe(false);

    // 3. Reject signature against different keypair
    const otherKeyPair = generateEd25519KeyPair();
    const isOtherKeyValid = verifyApprovalSignature(
      { ...rawResult, signature },
      otherKeyPair.publicKeyPem
    );
    expect(isOtherKeyValid).toBe(false);
  });

  it('mints and validates Ed25519-signed Capability Tokens (M2 CapabilityIssuer)', () => {
    const clock = new FrozenClock(1700000000000);
    const keyPair = generateEd25519KeyPair();

    const capToken = issueSignedCapToken(
      'ai:tactical-copilot',
      ['read.telemetry', 'operate.cesium', 'write.scenes'],
      300, // 5 min TTL
      keyPair.privateKeyPem,
      clock
    );

    expect(capToken.token.startsWith('cap-ed25519.')).toBe(true);
    expect(capToken.claims.sub).toBe('ai:tactical-copilot');
    expect(capToken.claims.scopes).toEqual(['read.telemetry', 'operate.cesium', 'write.scenes']);

    // Valid verification
    const verifiedScopes = verifySignedCapToken(capToken, keyPair.publicKeyPem, clock);
    expect(verifiedScopes).toEqual(['read.telemetry', 'operate.cesium', 'write.scenes']);

    // Expired verification (advance clock 301 seconds)
    clock.setTime(1700000000000 + 301 * 1000);
    const expiredScopes = verifySignedCapToken(capToken, keyPair.publicKeyPem, clock);
    expect(expiredScopes).toBeNull();
  });

  it('maintains tamper-evident Merkle hash chain across audit entries', () => {
    const chain = new MerkleAuditChain();

    const entry1 = { kind: 'audit.intent', id: 'uuid-1', action: 'camera.reposition' };
    const entry2 = { kind: 'audit.outcome', intent_id: 'uuid-1', status: 'ok' };
    const entry3 = { kind: 'audit.intent', id: 'uuid-2', action: 'layer.toggle' };

    const hash1 = chain.append(entry1);
    const hash2 = chain.append(entry2);
    const hash3 = chain.append(entry3);

    expect(hash1).toHaveLength(64); // SHA-256 hex string
    expect(hash2).toHaveLength(64);
    expect(hash3).toHaveLength(64);
    expect(hash1).not.toBe(hash2);
    expect(hash2).not.toBe(hash3);

    // Verify whole chain integrity
    const isValidChain = MerkleAuditChain.verifyChain([entry1, entry2, entry3], hash3);
    expect(isValidChain).toBe(true);

    // Tampering with any entry invalidates the chain
    const tamperedEntry2 = { ...entry2, status: 'error' };
    const isTamperedChainValid = MerkleAuditChain.verifyChain(
      [entry1, tamperedEntry2, entry3],
      hash3
    );
    expect(isTamperedChainValid).toBe(false);
  });

  it('TadpoleM2Gatekeeper generates cryptographically signed approvals conforming to port', async () => {
    const gatekeeper = new TadpoleM2Gatekeeper();
    const requestId = crypto.randomUUID();
    const intentId = crypto.randomUUID();

    const result = await gatekeeper.request({
      id: requestId,
      ts: new Date().toISOString(),
      intent_id: intentId,
      scopes: ['spend.external', 'flags.write'],
      rationale: 'Authorize tactical satellite sensor pointing',
      expires_at: new Date(Date.now() + 60000).toISOString(),
    });

    expect(result.decision).toBe('approved');
    expect(result.signature).toBeDefined();
    expect(gatekeeper.verifyResult(result)).toBe(true);
  });
});
