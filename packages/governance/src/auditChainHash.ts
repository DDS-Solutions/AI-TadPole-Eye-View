import crypto from 'node:crypto';
import {
  AUDIT_CHAIN_VERSION,
  AUDIT_EVENT_FORMAT_VERSION,
  AUDIT_LINK_FORMAT_VERSION,
  type AuditEntry,
  AuditEntrySchema,
  type AuditIntent,
  type AuditOutcome,
  GevEvents,
} from '@gev/contracts';
import { serializeSanitizedAuditValue } from './auditRedaction.js';
import { canonicalizeJson } from './canonicalJson.js';

export const SHA256_HEX = /^[a-f0-9]{64}$/;
export const AUDIT_GENESIS_HASH = crypto
  .createHash('sha256')
  .update(`${AUDIT_CHAIN_VERSION}:genesis`, 'utf8')
  .digest('hex');

export interface AuditEventStorageRow {
  id: string;
  kind: string;
  intent_id: string | null;
  ts: string;
  actor: string | null;
  action: string | null;
  target: string | null;
  params: string | null;
  task_ref: string | null;
  status: string | null;
  result: string | null;
  error: string | null;
  duration_ms: number | null;
}

export interface AuditChainRow {
  sequence: number;
  event_id: string;
  chain_version: string;
  redaction_version: string;
  previous_hash: string;
  payload_hash: string;
  chain_hash: string;
  appended_at: string;
}

export function auditIntentToStorageRow(intent: AuditIntent): AuditEventStorageRow {
  return {
    id: intent.id,
    kind: intent.kind,
    intent_id: null,
    ts: intent.ts,
    actor: intent.actor,
    action: intent.action,
    target: intent.target,
    params: intent.params === undefined ? null : serializeSanitizedAuditValue(intent.params),
    task_ref: intent.task_ref,
    status: null,
    result: null,
    error: null,
    duration_ms: null,
  };
}

export function auditOutcomeToStorageRow(
  outcome: AuditOutcome,
  rowId = crypto.randomUUID()
): AuditEventStorageRow {
  return {
    id: rowId,
    kind: outcome.kind,
    intent_id: outcome.intent_id,
    ts: outcome.ts,
    actor: null,
    action: null,
    target: null,
    params: null,
    task_ref: null,
    status: outcome.status,
    result: outcome.result === undefined ? null : serializeSanitizedAuditValue(outcome.result),
    error: outcome.error ?? null,
    duration_ms: outcome.duration_ms ?? null,
  };
}

export function computeAuditPayloadHash(
  row: AuditEventStorageRow,
  redactionVersion: string
): string {
  const canonical = canonicalizeJson({
    format: AUDIT_EVENT_FORMAT_VERSION,
    redaction_version: redactionVersion,
    row: {
      action: row.action,
      actor: row.actor,
      duration_ms: row.duration_ms,
      error: row.error,
      id: row.id,
      intent_id: row.intent_id,
      kind: row.kind,
      params: row.params,
      result: row.result,
      status: row.status,
      target: row.target,
      task_ref: row.task_ref,
      ts: row.ts,
    },
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function computeAuditChainHash(
  sequence: number,
  previousHash: string,
  payloadHash: string
): string {
  const canonical = canonicalizeJson({
    format: AUDIT_LINK_FORMAT_VERSION,
    chain_version: AUDIT_CHAIN_VERSION,
    payload_hash: payloadHash,
    previous_hash: previousHash,
    sequence,
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function auditStorageRowToEntry(row: AuditEventStorageRow): AuditEntry {
  if (row.kind === GevEvents.AuditIntent) {
    return AuditEntrySchema.parse({
      kind: GevEvents.AuditIntent,
      id: row.id,
      ts: row.ts,
      actor: row.actor,
      action: row.action,
      target: row.target,
      ...(row.params === null ? {} : { params: JSON.parse(row.params) }),
      task_ref: row.task_ref,
    });
  }
  if (row.kind === GevEvents.AuditOutcome) {
    return AuditEntrySchema.parse({
      kind: GevEvents.AuditOutcome,
      intent_id: row.intent_id,
      ts: row.ts,
      status: row.status,
      ...(row.result === null ? {} : { result: JSON.parse(row.result) }),
      ...(row.error === null ? {} : { error: row.error }),
      ...(row.duration_ms === null ? {} : { duration_ms: row.duration_ms }),
    });
  }
  throw new Error('Unsupported audit event kind');
}
