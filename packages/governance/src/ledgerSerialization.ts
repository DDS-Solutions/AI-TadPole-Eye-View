import crypto from 'node:crypto';
import {
  type AtomicLedgerAuditOutcome,
  GevEvents,
  type LedgerFingerprintComponents,
  LedgerFingerprintComponentsSchema,
  type LedgerOperation,
  MAX_LEDGER_RESULT_BYTES,
} from '@gev/contracts';
import { type CanonicalJson, canonicalizeJson } from './canonicalJson.js';

export function canonicalizeLedgerComponents(components: LedgerFingerprintComponents): string {
  const json = JSON.stringify(LedgerFingerprintComponentsSchema.parse(components));
  if (json === undefined)
    throw new Error('Ledger fingerprint components are not JSON serializable');
  return canonicalizeJson(JSON.parse(json) as CanonicalJson);
}

export function fingerprintLedgerComponents(components: LedgerFingerprintComponents): string {
  return crypto
    .createHash('sha256')
    .update(canonicalizeLedgerComponents(components), 'utf8')
    .digest('hex');
}

export function normalizeTerminalResult(
  operationId: string,
  value: unknown
): { json: string; digest: string } {
  const raw = JSON.stringify(value);
  if (raw === undefined) throw new Error('Terminal result is not JSON serializable');
  const canonical = canonicalizeJson(JSON.parse(raw) as CanonicalJson);
  const originalDigest = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  if (Buffer.byteLength(canonical, 'utf8') <= MAX_LEDGER_RESULT_BYTES) {
    return { json: canonical, digest: originalDigest };
  }
  const bounded = canonicalizeJson({
    success: false,
    status: 'error',
    code: 'OUTPUT_TOO_LARGE',
    intent_id: operationId,
    error: 'Validated terminal output exceeded the durable replay limit',
    result_digest: originalDigest,
  });
  return {
    json: bounded,
    digest: crypto.createHash('sha256').update(bounded, 'utf8').digest('hex'),
  };
}

export function blockedLedgerResult(
  operationId: string,
  code: string,
  error: string,
  action?: string
): unknown {
  return {
    success: false,
    status: 'blocked',
    blocked: true,
    tool: action?.startsWith('tool.') ? action.slice(5) : (action ?? 'governed-operation'),
    intent_id: operationId,
    code,
    error,
    duration_ms: 0,
  };
}

export function reconciliationLedgerResult(
  operation: LedgerOperation,
  resolution: 'settled' | 'refunded',
  actual: number
): unknown {
  return {
    success: false,
    status: 'error',
    tool: operation.fingerprint_components.action.startsWith('tool.')
      ? operation.fingerprint_components.action.slice(5)
      : operation.fingerprint_components.action,
    intent_id: operation.intent_id,
    code: 'OPERATION_RECONCILED',
    error: `Human reconciled ambiguous operation as ${resolution}`,
    duration_ms: 0,
    reconciliation: { resolution, actual_microusd: actual },
  };
}

export function createLedgerAuditOutcome(
  intentId: string,
  ts: string,
  status: 'ok' | 'error' | 'blocked',
  result: unknown,
  error?: string
): AtomicLedgerAuditOutcome {
  return {
    kind: GevEvents.AuditOutcome,
    intent_id: intentId,
    ts,
    status,
    result,
    ...(error ? { error } : {}),
  };
}
