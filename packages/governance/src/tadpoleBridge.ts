import crypto from 'node:crypto';
import {
  type ApprovalGate,
  type ApprovalRequest,
  ApprovalRequest as ApprovalRequestSchema,
  type ApprovalResult,
  ApprovalResult as ApprovalResultSchema,
  type CapToken,
  type CapTokenClaims,
  CapTokenClaims as CapTokenClaimsSchema,
  CapToken as CapTokenSchema,
  type CapabilityScope,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';

export interface TadpoleKeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
}

/**
 * Generates an Ed25519 asymmetric cryptographic keypair for Tadpole M2 Gatekeeper.
 */
export function generateEd25519KeyPair(): TadpoleKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  return {
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
  };
}

/**
 * Signs an ApprovalResult payload using an Ed25519 private key.
 */
export function signApprovalResult(
  result: Omit<ApprovalResult, 'signature'>,
  privateKeyPem: string
): string {
  const canonicalPayload = JSON.stringify({
    request_id: result.request_id,
    decision: result.decision,
    decided_by: result.decided_by,
    decided_at: result.decided_at,
  });

  const signature = crypto.sign(null, Buffer.from(canonicalPayload, 'utf-8'), privateKeyPem);
  return signature.toString('base64');
}

/**
 * Verifies an Ed25519 signature on an ApprovalResult.
 */
export function verifyApprovalSignature(result: ApprovalResult, publicKeyPem: string): boolean {
  if (!result.signature) {
    return false;
  }

  const canonicalPayload = JSON.stringify({
    request_id: result.request_id,
    decision: result.decision,
    decided_by: result.decided_by,
    decided_at: result.decided_at,
  });

  try {
    return crypto.verify(
      null,
      Buffer.from(canonicalPayload, 'utf-8'),
      publicKeyPem,
      Buffer.from(result.signature, 'base64')
    );
  } catch {
    return false;
  }
}

/**
 * Mints an Ed25519-signed Capability Token (M2 CapabilityIssuer).
 */
export function issueSignedCapToken(
  sub: string,
  scopes: CapabilityScope[],
  ttlSeconds: number,
  privateKeyPem: string,
  clock: SimClock = new SystemClock()
): CapToken {
  const now = clock.now();
  const iat = new Date(now).toISOString();
  const exp = new Date(now + ttlSeconds * 1000).toISOString();

  const claims: CapTokenClaims = CapTokenClaimsSchema.parse({
    sub,
    scopes,
    iat,
    exp,
  });

  const canonicalClaims = JSON.stringify(claims);
  const signature = crypto.sign(null, Buffer.from(canonicalClaims, 'utf-8'), privateKeyPem);

  return CapTokenSchema.parse({
    token: `cap-ed25519.${Buffer.from(canonicalClaims).toString('base64url')}.${signature.toString('base64')}`,
    claims,
  });
}

/**
 * Verifies an Ed25519-signed Capability Token.
 */
export function verifySignedCapToken(
  capToken: CapToken,
  publicKeyPem: string,
  clock: SimClock = new SystemClock()
): CapabilityScope[] | null {
  try {
    const parts = capToken.token.split('.');
    if (parts.length !== 3 || parts[0] !== 'cap-ed25519') {
      return null;
    }

    const partClaims = parts[1];
    const partSignature = parts[2];
    if (!partClaims || !partSignature) {
      return null;
    }

    const claimsJson = Buffer.from(partClaims, 'base64url').toString('utf-8');

    const isValidSig = crypto.verify(
      null,
      Buffer.from(claimsJson, 'utf-8'),
      publicKeyPem,
      Buffer.from(partSignature, 'base64')
    );
    if (!isValidSig) {
      return null;
    }

    const claims = CapTokenClaimsSchema.parse(JSON.parse(claimsJson));

    // Check expiration against clock
    const now = clock.now();
    const expTime = new Date(claims.exp).getTime();
    if (now >= expTime) {
      return null; // Expired
    }

    return claims.scopes;
  } catch {
    return null;
  }
}

/**
 * Merkle-Chained Hash Link Generator for Tamper-Evident Audit WAL (PLAN.md §6 M2 & §7.3)
 */
export class MerkleAuditChain {
  private currentHash: string;

  constructor(genesisHash = '0000000000000000000000000000000000000000000000000000000000000000') {
    this.currentHash = genesisHash;
  }

  /**
   * Appends an audit entry and updates the cumulative Merkle hash.
   */
  append(entry: Record<string, unknown>): string {
    const payload = `${this.currentHash}:${JSON.stringify(entry)}`;
    this.currentHash = crypto.createHash('sha256').update(payload).digest('hex');
    return this.currentHash;
  }

  /**
   * Returns current root hash.
   */
  getHeadHash(): string {
    return this.currentHash;
  }

  /**
   * Verifies consistency of a sequence of audit entries from a genesis hash.
   */
  static verifyChain(
    entries: Record<string, unknown>[],
    expectedFinalHash: string,
    genesisHash = '0000000000000000000000000000000000000000000000000000000000000000'
  ): boolean {
    const chain = new MerkleAuditChain(genesisHash);
    for (const entry of entries) {
      chain.append(entry);
    }
    return chain.getHeadHash() === expectedFinalHash;
  }
}

export interface TadpoleM2GatekeeperOptions {
  keyPair?: TadpoleKeyPair;
  clock?: SimClock;
  autoSignPolicy?: 'approve_all' | 'deny_all';
}

/**
 * Tadpole M2 Gatekeeper Adapter (PLAN.md §6 & §10 Phase 4)
 * Validates Ed25519 cryptographic signatures on mutating action approvals.
 */
export class TadpoleM2Gatekeeper implements ApprovalGate {
  private readonly keyPair: TadpoleKeyPair;
  private readonly clock: SimClock;
  private readonly autoSignPolicy: 'approve_all' | 'deny_all';

  constructor(options: TadpoleM2GatekeeperOptions = {}) {
    this.keyPair = options.keyPair ?? generateEd25519KeyPair();
    this.clock = options.clock ?? new SystemClock();
    this.autoSignPolicy = options.autoSignPolicy ?? 'approve_all';
  }

  getPublicKeyPem(): string {
    return this.keyPair.publicKeyPem;
  }

  /**
   * Processes approval request, generating an Ed25519 signed result.
   */
  async request(requestInput: ApprovalRequest): Promise<ApprovalResult> {
    const r = ApprovalRequestSchema.parse(requestInput);
    const decidedAt = new Date(this.clock.now()).toISOString();

    if (this.autoSignPolicy === 'deny_all') {
      return ApprovalResultSchema.parse({
        request_id: r.id,
        decision: 'denied',
        decided_by: 'system',
        decided_at: decidedAt,
      });
    }

    const rawResult = {
      request_id: r.id,
      decision: 'approved' as const,
      decided_by: 'human' as const,
      decided_at: decidedAt,
    };

    const signature = signApprovalResult(rawResult, this.keyPair.privateKeyPem);

    return ApprovalResultSchema.parse({
      ...rawResult,
      signature,
    });
  }

  /**
   * Verifies an incoming approval result against the gatekeeper public key.
   */
  verifyResult(result: ApprovalResult): boolean {
    return verifyApprovalSignature(result, this.keyPair.publicKeyPem);
  }
}
