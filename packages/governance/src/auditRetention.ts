import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  AUDIT_CHAIN_VERSION,
  AUDIT_RETENTION_FORMAT_VERSION,
  type AuditIntegrityFailureCode,
} from '@gev/contracts';
import type { SimClock } from '@gev/core';
import { AUDIT_GENESIS_HASH, SHA256_HEX } from './auditChainHash.js';
import { redactAuditText } from './auditRedaction.js';
import { canonicalizeJson } from './canonicalJson.js';

export interface AuditChainStateRow {
  chain_version: string;
  genesis_hash: string;
  anchor_sequence: number;
  anchor_hash: string;
  head_sequence: number;
  head_hash: string;
  last_retention_receipt_id: string | null;
  updated_at: string;
}

export interface AuditRetentionReceiptRow {
  receipt_id: string;
  format: string;
  chain_version: string;
  previous_receipt_id: string | null;
  previous_anchor_sequence: number;
  previous_anchor_hash: string;
  pruned_through_sequence: number;
  pruned_through_hash: string;
  retained_from_sequence: number;
  head_sequence: number;
  head_hash: string;
  approved_at: string;
  approved_by: string;
  reason: string;
  signer_id: string;
  key_id: string;
  algorithm: string;
  signature: string;
  payload_json: string;
}

export interface TrustedAuditRetentionKey {
  signerId: string;
  keyId: string;
  publicKeyPem: string;
  status: 'active' | 'retired' | 'revoked';
  validFrom?: string;
  validUntil?: string;
}

export interface AuditRetentionSigner {
  signerId: string;
  keyId: string;
  sign(payload: Uint8Array): Uint8Array;
}

export interface AuditRetentionPolicy {
  minimumRetainedEntries?: number;
  maximumPruneEntries?: number;
}

export interface AuditRetentionRequest {
  actor: 'human';
  pruneThroughSequence: number;
  reason: string;
  signer: AuditRetentionSigner;
}

export interface AuditRetentionResult {
  receiptId: string;
  prunedEntries: number;
  anchorSequence: number;
  anchorHash: string;
  retainedFromSequence: number;
}

export interface RetentionVerificationResult {
  valid: boolean;
  failureCode?: AuditIntegrityFailureCode;
  failureSequence?: number;
  receiptCount: number;
}

const DEFAULT_MINIMUM_RETAINED_ENTRIES = 100;
const DEFAULT_MAXIMUM_PRUNE_ENTRIES = 10_000;

function canonicalReceiptPayload(
  row: Omit<AuditRetentionReceiptRow, 'signature' | 'payload_json'>
) {
  return canonicalizeJson({
    algorithm: row.algorithm,
    approved_at: row.approved_at,
    approved_by: row.approved_by,
    chain_version: row.chain_version,
    format: row.format,
    head_hash: row.head_hash,
    head_sequence: row.head_sequence,
    key_id: row.key_id,
    previous_anchor_hash: row.previous_anchor_hash,
    previous_anchor_sequence: row.previous_anchor_sequence,
    previous_receipt_id: row.previous_receipt_id,
    pruned_through_hash: row.pruned_through_hash,
    pruned_through_sequence: row.pruned_through_sequence,
    reason: row.reason,
    receipt_id: row.receipt_id,
    retained_from_sequence: row.retained_from_sequence,
    signer_id: row.signer_id,
  });
}

function findTrustedKey(
  keys: readonly TrustedAuditRetentionKey[],
  signerId: string,
  keyId: string
): TrustedAuditRetentionKey | undefined {
  return keys.find((key) => key.signerId === signerId && key.keyId === keyId);
}

function keyValidAt(key: TrustedAuditRetentionKey, at: string, requireActive: boolean): boolean {
  if (key.status === 'revoked' || (requireActive && key.status !== 'active')) return false;
  const timestamp = Date.parse(at);
  if (!Number.isFinite(timestamp)) return false;
  if (key.validFrom) {
    const validFrom = Date.parse(key.validFrom);
    if (!Number.isFinite(validFrom) || timestamp < validFrom) return false;
  }
  if (key.validUntil) {
    const validUntil = Date.parse(key.validUntil);
    if (!Number.isFinite(validUntil) || timestamp > validUntil) return false;
  }
  return true;
}

function signatureBytes(signature: string): Buffer | null {
  try {
    const bytes = Buffer.from(signature, 'base64url');
    return bytes.length === 64 && bytes.toString('base64url') === signature ? bytes : null;
  } catch {
    return null;
  }
}

function verifyReceiptSignature(
  row: AuditRetentionReceiptRow,
  payload: string,
  keys: readonly TrustedAuditRetentionKey[]
): boolean {
  const key = findTrustedKey(keys, row.signer_id, row.key_id);
  const signature = signatureBytes(row.signature);
  if (!key || !signature || !keyValidAt(key, row.approved_at, false)) return false;
  try {
    return crypto.verify(null, Buffer.from(payload, 'utf8'), key.publicKeyPem, signature);
  } catch {
    return false;
  }
}

export function verifyRetentionHistory(
  receipts: readonly AuditRetentionReceiptRow[],
  state: AuditChainStateRow,
  trustedKeys: readonly TrustedAuditRetentionKey[]
): RetentionVerificationResult {
  let anchorSequence = 0;
  let anchorHash = AUDIT_GENESIS_HASH;
  let previousReceiptId: string | null = null;

  for (const row of receipts) {
    if (
      row.format !== AUDIT_RETENTION_FORMAT_VERSION ||
      row.chain_version !== AUDIT_CHAIN_VERSION ||
      row.algorithm !== 'Ed25519' ||
      row.approved_by !== 'human' ||
      row.previous_anchor_sequence !== anchorSequence ||
      row.previous_anchor_hash !== anchorHash ||
      row.previous_receipt_id !== previousReceiptId ||
      row.pruned_through_sequence <= anchorSequence ||
      row.retained_from_sequence !== row.pruned_through_sequence + 1 ||
      row.head_sequence < row.pruned_through_sequence ||
      !SHA256_HEX.test(row.pruned_through_hash) ||
      !SHA256_HEX.test(row.head_hash)
    ) {
      return {
        valid: false,
        failureCode: 'RETENTION_BOUNDARY_MISMATCH',
        failureSequence: Math.max(1, row.pruned_through_sequence),
        receiptCount: receipts.length,
      };
    }
    const { signature: storedSignature, payload_json: storedPayload, ...unsigned } = row;
    void storedSignature;
    void storedPayload;
    const payload = canonicalReceiptPayload(unsigned);
    if (payload !== row.payload_json || !verifyReceiptSignature(row, payload, trustedKeys)) {
      return {
        valid: false,
        failureCode: 'RETENTION_SIGNATURE_INVALID',
        failureSequence: row.pruned_through_sequence,
        receiptCount: receipts.length,
      };
    }
    anchorSequence = row.pruned_through_sequence;
    anchorHash = row.pruned_through_hash;
    previousReceiptId = row.receipt_id;
  }

  if (
    state.anchor_sequence !== anchorSequence ||
    state.anchor_hash !== anchorHash ||
    state.last_retention_receipt_id !== previousReceiptId
  ) {
    return {
      valid: false,
      failureCode: 'RETENTION_BOUNDARY_MISMATCH',
      failureSequence: anchorSequence || undefined,
      receiptCount: receipts.length,
    };
  }
  return { valid: true, receiptCount: receipts.length };
}

export function applyAuditRetention(
  db: DatabaseSync,
  clock: SimClock,
  request: AuditRetentionRequest,
  trustedKeys: readonly TrustedAuditRetentionKey[],
  policy: AuditRetentionPolicy = {}
): AuditRetentionResult {
  if (request.actor !== 'human') throw new Error('Audit retention requires a human actor');
  if (!Number.isSafeInteger(request.pruneThroughSequence) || request.pruneThroughSequence < 1) {
    throw new Error('Audit retention cutoff must be a positive safe integer');
  }
  const reason = redactAuditText(request.reason.trim(), 1_024);
  if (reason.length < 8)
    throw new Error('Audit retention reason must contain at least 8 characters');

  const state = db
    .prepare('SELECT * FROM governance_audit_chain_state WHERE singleton_id = 1')
    .get() as AuditChainStateRow | undefined;
  if (!state) throw new Error('Audit chain state is missing');
  const budget = db
    .prepare('SELECT stasis_active FROM governance_budget_state WHERE singleton_id = 1')
    .get() as { stasis_active: number } | undefined;
  const inDoubt = db
    .prepare("SELECT COUNT(*) AS count FROM governance_budget_operations WHERE state = 'IN_DOUBT'")
    .get() as { count: number };
  if (budget?.stasis_active === 1 || inDoubt.count > 0) {
    throw new Error('Audit retention is blocked by active incident or reconciliation evidence');
  }

  const minimumRetained = policy.minimumRetainedEntries ?? DEFAULT_MINIMUM_RETAINED_ENTRIES;
  const maximumPrune = policy.maximumPruneEntries ?? DEFAULT_MAXIMUM_PRUNE_ENTRIES;
  const pruneCount = request.pruneThroughSequence - state.anchor_sequence;
  if (!Number.isSafeInteger(minimumRetained) || minimumRetained < 1) {
    throw new Error('Audit retention policy minimum must be a positive safe integer');
  }
  if (!Number.isSafeInteger(maximumPrune) || maximumPrune < 1) {
    throw new Error('Audit retention policy batch limit must be a positive safe integer');
  }
  if (pruneCount < 1 || pruneCount > maximumPrune) {
    throw new Error('Audit retention cutoff violates the bounded prune policy');
  }
  if (state.head_sequence - request.pruneThroughSequence < minimumRetained) {
    throw new Error('Audit retention cutoff would leave too few retained entries');
  }

  const cutoff = db
    .prepare('SELECT event_id, chain_hash FROM governance_audit_chain WHERE sequence = ?')
    .get(request.pruneThroughSequence) as { event_id: string; chain_hash: string } | undefined;
  if (!cutoff || !SHA256_HEX.test(cutoff.chain_hash)) {
    throw new Error('Audit retention cutoff is not a valid chain boundary');
  }

  const approvedAt = new Date(clock.now()).toISOString();
  const key = findTrustedKey(trustedKeys, request.signer.signerId, request.signer.keyId);
  if (!key || !keyValidAt(key, approvedAt, true)) {
    throw new Error('Audit retention signer is not an active trusted key');
  }
  const receiptId = crypto.randomUUID();
  const unsigned = {
    receipt_id: receiptId,
    format: AUDIT_RETENTION_FORMAT_VERSION,
    chain_version: AUDIT_CHAIN_VERSION,
    previous_receipt_id: state.last_retention_receipt_id,
    previous_anchor_sequence: state.anchor_sequence,
    previous_anchor_hash: state.anchor_hash,
    pruned_through_sequence: request.pruneThroughSequence,
    pruned_through_hash: cutoff.chain_hash,
    retained_from_sequence: request.pruneThroughSequence + 1,
    head_sequence: state.head_sequence,
    head_hash: state.head_hash,
    approved_at: approvedAt,
    approved_by: 'human',
    reason,
    signer_id: request.signer.signerId,
    key_id: request.signer.keyId,
    algorithm: 'Ed25519',
  } satisfies Omit<AuditRetentionReceiptRow, 'signature' | 'payload_json'>;
  const payload = canonicalReceiptPayload(unsigned);
  const signatureBytesValue = Buffer.from(request.signer.sign(Buffer.from(payload, 'utf8')));
  if (signatureBytesValue.length !== 64) throw new Error('Audit retention signature is invalid');
  const signature = signatureBytesValue.toString('base64url');
  const receipt: AuditRetentionReceiptRow = { ...unsigned, signature, payload_json: payload };
  if (!verifyReceiptSignature(receipt, payload, trustedKeys)) {
    throw new Error('Audit retention signature did not verify against the trusted key');
  }

  db.prepare(`INSERT INTO governance_audit_retention_receipts (
    receipt_id, format, chain_version, previous_receipt_id, previous_anchor_sequence,
    previous_anchor_hash, pruned_through_sequence, pruned_through_hash,
    retained_from_sequence, head_sequence, head_hash, approved_at, approved_by,
    reason, signer_id, key_id, algorithm, signature, payload_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    receipt.receipt_id,
    receipt.format,
    receipt.chain_version,
    receipt.previous_receipt_id,
    receipt.previous_anchor_sequence,
    receipt.previous_anchor_hash,
    receipt.pruned_through_sequence,
    receipt.pruned_through_hash,
    receipt.retained_from_sequence,
    receipt.head_sequence,
    receipt.head_hash,
    receipt.approved_at,
    receipt.approved_by,
    receipt.reason,
    receipt.signer_id,
    receipt.key_id,
    receipt.algorithm,
    receipt.signature,
    receipt.payload_json
  );

  const eventRows = db
    .prepare('SELECT event_id FROM governance_audit_chain WHERE sequence <= ? ORDER BY sequence')
    .all(request.pruneThroughSequence) as unknown as Array<{ event_id: string }>;
  db.prepare(
    'UPDATE governance_audit_mutation_guard SET retention_active = 1 WHERE singleton_id = 1'
  ).run();
  db.prepare('DELETE FROM governance_audit_chain WHERE sequence <= ?').run(
    request.pruneThroughSequence
  );
  const deleteEvent = db.prepare('DELETE FROM audit_events WHERE id = ?');
  for (const row of eventRows) deleteEvent.run(row.event_id);
  db.prepare(`UPDATE governance_audit_chain_state SET anchor_sequence = ?, anchor_hash = ?,
    last_retention_receipt_id = ?, updated_at = ? WHERE singleton_id = 1`).run(
    request.pruneThroughSequence,
    cutoff.chain_hash,
    receiptId,
    approvedAt
  );
  db.prepare(
    'UPDATE governance_audit_mutation_guard SET retention_active = 0 WHERE singleton_id = 1'
  ).run();

  return {
    receiptId,
    prunedEntries: eventRows.length,
    anchorSequence: request.pruneThroughSequence,
    anchorHash: cutoff.chain_hash,
    retainedFromSequence: request.pruneThroughSequence + 1,
  };
}
