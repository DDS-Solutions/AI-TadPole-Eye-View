import crypto from 'node:crypto';
import {
  type CapToken,
  type CapTokenClaims,
  CapTokenClaims as CapTokenClaimsSchema,
  CapToken as CapTokenSchema,
  type CapabilityScope,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';

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
 * Disconnected in-memory shadow-hash helper used only by the local CLI demonstration.
 * Durable SQLite integrity is implemented by AuditChainStore (ADR 0044).
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
