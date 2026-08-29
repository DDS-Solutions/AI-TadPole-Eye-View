import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  type ApprovalGate,
  type ApprovalProviderResponse,
  ApprovalProviderResponseSchema,
  type ApprovalRequest,
  ApprovalRequest as ApprovalRequestSchema,
  type ApprovalResult,
  ApprovalResult as ApprovalResultSchema,
  type ApprovalScope,
  type SignedApprovalEnvelope,
  SignedApprovalEnvelopeSchema,
  type SignedApprovalPayload,
  SignedApprovalPayloadSchema,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import { type CanonicalJsonObject, canonicalizeJson } from './canonicalJson.js';
import { openGovernanceDatabase, withImmediateTransaction } from './governanceDb.js';

export const DEFAULT_APPROVAL_LIFETIME_MS = 60_000;
export const DEFAULT_APPROVAL_CLOCK_SKEW_MS = 5_000;

export interface TadpoleKeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
}

export function generateEd25519KeyPair(): TadpoleKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

/** RFC 8785 JCS serialization for the constrained I-JSON approval payload. */
export function canonicalizeSignedApprovalPayload(payload: SignedApprovalPayload): string {
  const parsed = SignedApprovalPayloadSchema.parse(payload);
  return canonicalizeJson(parsed as CanonicalJsonObject);
}

export function signApprovalPayload(
  payloadInput: SignedApprovalPayload,
  privateKeyPem: string
): SignedApprovalEnvelope {
  const payload = SignedApprovalPayloadSchema.parse(payloadInput);
  const signature = crypto.sign(
    null,
    Buffer.from(canonicalizeSignedApprovalPayload(payload), 'utf8'),
    privateKeyPem
  );
  return SignedApprovalEnvelopeSchema.parse({
    algorithm: 'Ed25519',
    payload,
    signature: signature.toString('base64url'),
  });
}

export function verifySignedApprovalEnvelope(
  envelopeInput: SignedApprovalEnvelope,
  publicKey: crypto.KeyLike
): boolean {
  try {
    const envelope = SignedApprovalEnvelopeSchema.parse(envelopeInput);
    return crypto.verify(
      null,
      Buffer.from(canonicalizeSignedApprovalPayload(envelope.payload), 'utf8'),
      publicKey,
      Buffer.from(envelope.signature, 'base64url')
    );
  } catch {
    return false;
  }
}

export interface SignedApprovalProvider {
  decide(request: ApprovalRequest): Promise<ApprovalProviderResponse>;
}

export type TrustedApprovalKeyStatus = 'active' | 'retired' | 'revoked';

export interface TrustedApprovalKey {
  signerId: string;
  keyId: string;
  publicKeyPem: string;
  status: TrustedApprovalKeyStatus;
  validFrom?: string;
  validUntil?: string;
}

export interface ApprovalNonceStore {
  consume(payload: SignedApprovalPayload, consumedAt: string): void;
  close?(): void;
}

export class SqliteApprovalNonceStore implements ApprovalNonceStore {
  private readonly db: DatabaseSync;

  constructor(options: { dbPath?: string; clock?: SimClock } = {}) {
    this.db = openGovernanceDatabase(options).db;
  }

  consume(payload: SignedApprovalPayload, consumedAt: string): void {
    withImmediateTransaction(this.db, () => {
      const result = this.db
        .prepare(
          `INSERT OR IGNORE INTO governance_approval_nonces
            (nonce, request_id, intent_id, signer_id, key_id, consumed_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          payload.nonce,
          payload.request_id,
          payload.intent_id,
          payload.signer_id,
          payload.key_id,
          consumedAt,
          payload.expires_at
        );
      if (Number(result.changes) !== 1) {
        throw new Error('Signed approval replay detected; nonce or request was already consumed');
      }
    });
  }

  close(): void {
    this.db.close();
  }
}

export class InMemoryApprovalNonceStore implements ApprovalNonceStore {
  private readonly nonces = new Set<string>();
  private readonly requests = new Set<string>();

  consume(payload: SignedApprovalPayload): void {
    if (this.nonces.has(payload.nonce) || this.requests.has(payload.request_id)) {
      throw new Error('Signed approval replay detected; nonce or request was already consumed');
    }
    this.nonces.add(payload.nonce);
    this.requests.add(payload.request_id);
  }
}

interface ResolvedTrustedApprovalKey extends TrustedApprovalKey {
  publicKey: crypto.KeyObject;
  validFromMs?: number;
  validUntilMs?: number;
}

export interface SignedApprovalGateOptions {
  provider: SignedApprovalProvider;
  trustedKeys: readonly TrustedApprovalKey[];
  nonceStore: ApprovalNonceStore;
  clock?: SimClock;
  maxLifetimeMs?: number;
  clockSkewMs?: number;
}

export class SignedApprovalGate implements ApprovalGate {
  private readonly provider: SignedApprovalProvider;
  private readonly nonceStore: ApprovalNonceStore;
  private readonly clock: SimClock;
  private readonly maxLifetimeMs: number;
  private readonly clockSkewMs: number;
  private readonly trustedKeys: Map<string, ResolvedTrustedApprovalKey>;

  constructor(options: SignedApprovalGateOptions) {
    if (options.trustedKeys.length === 0) {
      throw new Error('Signed approval verification requires at least one trusted public key');
    }
    this.provider = options.provider;
    this.nonceStore = options.nonceStore;
    this.clock = options.clock ?? new SystemClock();
    this.maxLifetimeMs = options.maxLifetimeMs ?? DEFAULT_APPROVAL_LIFETIME_MS;
    this.clockSkewMs = options.clockSkewMs ?? DEFAULT_APPROVAL_CLOCK_SKEW_MS;
    if (this.maxLifetimeMs <= 0 || this.clockSkewMs < 0) {
      throw new Error('Approval lifetime must be positive and clock skew must be nonnegative');
    }
    const trustedKeys = new Map<string, ResolvedTrustedApprovalKey>();
    for (const key of options.trustedKeys) {
      const resolved = resolveTrustedKey(key);
      const identity = trustedKeyIdentity(key.signerId, key.keyId);
      if (trustedKeys.has(identity)) {
        throw new Error(`Duplicate trusted approval key: ${identity}`);
      }
      trustedKeys.set(identity, resolved);
    }
    this.trustedKeys = trustedKeys;
  }

  async request(requestInput: ApprovalRequest): Promise<ApprovalResult> {
    const request = ApprovalRequestSchema.parse(requestInput);
    const now = this.clock.now();
    const requestTime = parseTime(request.ts, 'request timestamp');
    const requestExpiry = parseTime(request.expires_at, 'request expiry');

    if (requestTime > now + this.clockSkewMs) {
      throw new Error('Approval request timestamp is too far in the future');
    }
    if (requestExpiry <= requestTime || requestExpiry - requestTime > this.maxLifetimeMs) {
      throw new Error('Approval request lifetime exceeds the configured maximum');
    }
    if (now >= requestExpiry) {
      return ApprovalResultSchema.parse({
        request_id: request.id,
        decision: 'expired',
        decided_by: 'system',
        decided_at: this.clock.iso(),
      });
    }

    let response: ApprovalProviderResponse;
    try {
      response = ApprovalProviderResponseSchema.parse(await this.provider.decide(request));
    } catch {
      throw new Error('Signed approval provider unavailable or returned an invalid response');
    }
    if (response.decision !== 'approved') {
      this.validateSafeDenial(response, request, now);
      return ApprovalResultSchema.parse(response);
    }

    const envelope = response.signed_approval;
    this.validateSignedPayload(envelope.payload, request, now, requestTime, requestExpiry);
    const trustedKey = this.getTrustedKey(envelope.payload);
    this.validateTrustedKeyWindow(trustedKey, parseTime(envelope.payload.decided_at, 'decision'));
    if (!verifySignedApprovalEnvelope(envelope, trustedKey.publicKey)) {
      throw new Error('Signed approval signature verification failed');
    }
    this.nonceStore.consume(envelope.payload, this.clock.iso());

    return ApprovalResultSchema.parse({
      request_id: envelope.payload.request_id,
      decision: 'approved',
      signature: envelope.signature,
      decided_by: envelope.payload.decided_by,
      decided_at: envelope.payload.decided_at,
    });
  }

  close(): void {
    this.nonceStore.close?.();
  }

  private validateSafeDenial(
    response: Extract<ApprovalProviderResponse, { decision: 'denied' | 'expired' }>,
    request: ApprovalRequest,
    now: number
  ): void {
    if (response.request_id !== request.id) {
      throw new Error('Approval denial references the wrong request');
    }
    if (parseTime(response.decided_at, 'denial decision') > now + this.clockSkewMs) {
      throw new Error('Approval denial timestamp is too far in the future');
    }
  }

  private validateSignedPayload(
    payload: SignedApprovalPayload,
    request: ApprovalRequest,
    now: number,
    requestTime: number,
    requestExpiry: number
  ): void {
    if (
      payload.request_id !== request.id ||
      payload.intent_id !== request.intent_id ||
      payload.nonce !== request.nonce ||
      payload.expires_at !== request.expires_at
    ) {
      throw new Error('Signed approval does not bind the exact request, intent, nonce, and expiry');
    }
    const expectedScopes = canonicalScopes(request.scopes);
    if (JSON.stringify(payload.scopes) !== JSON.stringify(expectedScopes)) {
      throw new Error('Signed approval scopes do not exactly match the requested scopes');
    }

    const decidedAt = parseTime(payload.decided_at, 'decision');
    const issuedAt = parseTime(payload.issued_at, 'approval issuance');
    if (decidedAt < requestTime - this.clockSkewMs) {
      throw new Error('Signed approval decision predates its request');
    }
    if (issuedAt < decidedAt) {
      throw new Error('Signed approval was issued before its human decision');
    }
    if (decidedAt > now + this.clockSkewMs || issuedAt > now + this.clockSkewMs) {
      throw new Error('Signed approval contains a future decision or issuance time');
    }
    if (issuedAt >= requestExpiry || now >= requestExpiry) {
      throw new Error('Signed approval is stale or expired');
    }
  }

  private getTrustedKey(payload: SignedApprovalPayload): ResolvedTrustedApprovalKey {
    const key = this.trustedKeys.get(trustedKeyIdentity(payload.signer_id, payload.key_id));
    if (!key) {
      throw new Error('Signed approval uses an untrusted signer or key');
    }
    if (key.status === 'revoked') {
      throw new Error('Signed approval uses a revoked key');
    }
    return key;
  }

  private validateTrustedKeyWindow(key: ResolvedTrustedApprovalKey, decidedAt: number): void {
    if (key.validFromMs !== undefined && decidedAt < key.validFromMs) {
      throw new Error('Signed approval predates the trusted key validity window');
    }
    if (key.validUntilMs !== undefined && decidedAt >= key.validUntilMs) {
      throw new Error('Signed approval postdates the trusted key validity window');
    }
  }
}

export interface LocalSignedApprovalProviderOptions {
  signerId: string;
  keyId: string;
  privateKeyPem: string;
  policy: 'approve_all' | 'deny_all';
  clock?: SimClock;
}

/** Explicitly local seed/test signer. Production construction is forbidden. */
export class LocalSignedApprovalProvider implements SignedApprovalProvider {
  private readonly options: LocalSignedApprovalProviderOptions;
  private readonly clock: SimClock;

  constructor(options: LocalSignedApprovalProviderOptions) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Local signed approval provider is forbidden in production');
    }
    this.options = options;
    this.clock = options.clock ?? new SystemClock();
  }

  async decide(requestInput: ApprovalRequest): Promise<ApprovalProviderResponse> {
    const request = ApprovalRequestSchema.parse(requestInput);
    const decidedAt = this.clock.iso();
    if (this.options.policy === 'deny_all') {
      return ApprovalProviderResponseSchema.parse({
        request_id: request.id,
        decision: 'denied',
        decided_by: 'system',
        decided_at: decidedAt,
      });
    }
    const payload = SignedApprovalPayloadSchema.parse({
      format: 'gev.m2.approval.v1',
      request_id: request.id,
      intent_id: request.intent_id,
      decision: 'approved',
      scopes: canonicalScopes(request.scopes),
      signer_id: this.options.signerId,
      key_id: this.options.keyId,
      nonce: request.nonce,
      issued_at: decidedAt,
      decided_by: 'human',
      decided_at: decidedAt,
      expires_at: request.expires_at,
    });
    return {
      decision: 'approved',
      signed_approval: signApprovalPayload(payload, this.options.privateKeyPem),
    };
  }
}

/** Backward-compatible seed/demo gate with an explicit non-production name. */
export class LocalM2ApprovalDemoGate implements ApprovalGate {
  private readonly keyPair: TadpoleKeyPair;
  private readonly gate: SignedApprovalGate;

  constructor(
    options: {
      keyPair?: TadpoleKeyPair;
      clock?: SimClock;
      autoSignPolicy?: 'approve_all' | 'deny_all';
    } = {}
  ) {
    const clock = options.clock ?? new SystemClock();
    this.keyPair = options.keyPair ?? generateEd25519KeyPair();
    const signerId = 'human:local-demo';
    const keyId = 'local-demo-ed25519';
    this.gate = new SignedApprovalGate({
      clock,
      nonceStore: new InMemoryApprovalNonceStore(),
      trustedKeys: [{ signerId, keyId, publicKeyPem: this.keyPair.publicKeyPem, status: 'active' }],
      provider: new LocalSignedApprovalProvider({
        signerId,
        keyId,
        privateKeyPem: this.keyPair.privateKeyPem,
        policy: options.autoSignPolicy ?? 'approve_all',
        clock,
      }),
    });
  }

  getPublicKeyPem(): string {
    return this.keyPair.publicKeyPem;
  }

  request(request: ApprovalRequest): Promise<ApprovalResult> {
    return this.gate.request(request);
  }
}

function canonicalScopes(scopes: readonly ApprovalScope[]): ApprovalScope[] {
  return [...new Set(scopes)].sort();
}

function trustedKeyIdentity(signerId: string, keyId: string): string {
  return `${signerId}\u0000${keyId}`;
}

function parseTime(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}`);
  }
  return parsed;
}

function resolveTrustedKey(key: TrustedApprovalKey): ResolvedTrustedApprovalKey {
  if (!/^[a-z0-9][a-z0-9:_-]{2,127}$/.test(key.signerId)) {
    throw new Error('Trusted signer ID is invalid');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(key.keyId)) {
    throw new Error('Trusted key ID is invalid');
  }
  if (key.status !== 'active' && key.status !== 'retired' && key.status !== 'revoked') {
    throw new Error('Trusted approval key status is invalid');
  }
  const publicKey = crypto.createPublicKey(key.publicKeyPem);
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('Trusted approval key must be Ed25519');
  }
  const validFromMs = key.validFrom ? parseTime(key.validFrom, 'key validity start') : undefined;
  const validUntilMs = key.validUntil ? parseTime(key.validUntil, 'key validity end') : undefined;
  if (validFromMs !== undefined && validUntilMs !== undefined && validFromMs >= validUntilMs) {
    throw new Error('Trusted approval key validity window is empty');
  }
  if (key.status === 'retired' && validUntilMs === undefined) {
    throw new Error('Retired approval keys require a validity end');
  }
  return { ...key, publicKey, validFromMs, validUntilMs };
}
