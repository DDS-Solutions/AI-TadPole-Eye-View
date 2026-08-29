import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  AUDIT_CHAIN_VERSION,
  AUDIT_REDACTION_VERSION,
  type AuditIntegrityFailureCode,
  type AuditIntegrityStatus,
  AuditIntegrityStatusSchema,
  type AuditIntent,
  type AuditOutcome,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import {
  AUDIT_GENESIS_HASH,
  type AuditChainRow,
  type AuditEventStorageRow,
  SHA256_HEX,
  auditIntentToStorageRow,
  auditOutcomeToStorageRow,
  computeAuditChainHash,
  computeAuditPayloadHash,
} from './auditChainHash.js';
import { sanitizeAuditIntent, sanitizeAuditOutcome } from './auditRedaction.js';
import {
  type AuditChainStateRow,
  type AuditRetentionPolicy,
  type AuditRetentionReceiptRow,
  type AuditRetentionRequest,
  type AuditRetentionResult,
  type TrustedAuditRetentionKey,
  applyAuditRetention,
  verifyRetentionHistory,
} from './auditRetention.js';
import {
  GOVERNANCE_BUSY_TIMEOUT_MS,
  GOVERNANCE_SCHEMA_VERSION,
  resolveGovernanceDbPath,
} from './governanceDb.js';

export interface AuditIntegrityInspectionOptions {
  dbPath?: string;
  clock?: SimClock;
  trustedRetentionKeys?: readonly TrustedAuditRetentionKey[];
}

function verifiedAt(clock: SimClock): string {
  return new Date(clock.now()).toISOString();
}

function status(
  clock: SimClock,
  values: Omit<AuditIntegrityStatus, 'verified_at'>
): AuditIntegrityStatus {
  return AuditIntegrityStatusSchema.parse({ ...values, verified_at: verifiedAt(clock) });
}

function unavailable(clock: SimClock): AuditIntegrityStatus {
  return status(clock, {
    status: 'unavailable',
    chain_version: null,
    schema_version: null,
    anchor_sequence: null,
    anchor_hash: null,
    head_sequence: null,
    head_hash: null,
    verified_entries: 0,
    retention_receipts: 0,
    failure_code: 'STORAGE_UNAVAILABLE',
    failure_sequence: null,
  });
}

function validState(row: AuditChainStateRow | undefined): boolean {
  return !!(
    row &&
    row.chain_version === AUDIT_CHAIN_VERSION &&
    row.genesis_hash === AUDIT_GENESIS_HASH &&
    Number.isSafeInteger(row.anchor_sequence) &&
    row.anchor_sequence >= 0 &&
    Number.isSafeInteger(row.head_sequence) &&
    row.head_sequence >= row.anchor_sequence &&
    SHA256_HEX.test(row.anchor_hash) &&
    SHA256_HEX.test(row.head_hash)
  );
}

export class AuditChainStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly clock: SimClock,
    private readonly trustedRetentionKeys: readonly TrustedAuditRetentionKey[] = []
  ) {}

  appendIntent(input: AuditIntent): AuditIntent {
    const intent = sanitizeAuditIntent(input);
    this.appendStorageRow(auditIntentToStorageRow(intent), AUDIT_REDACTION_VERSION);
    return intent;
  }

  appendOutcome(input: AuditOutcome): AuditOutcome {
    const outcome = sanitizeAuditOutcome(input);
    this.appendStorageRow(auditOutcomeToStorageRow(outcome), AUDIT_REDACTION_VERSION);
    return outcome;
  }

  retain(request: AuditRetentionRequest, policy?: AuditRetentionPolicy): AuditRetentionResult {
    return applyAuditRetention(this.db, this.clock, request, this.trustedRetentionKeys, policy);
  }

  verifyIntegrity(): AuditIntegrityStatus {
    let schemaVersion: number | null = null;
    let stateRow: AuditChainStateRow | undefined;
    let verifiedEntries = 0;
    let receiptCount = 0;
    const fail = (
      code: AuditIntegrityFailureCode,
      sequence: number | null = null
    ): AuditIntegrityStatus =>
      status(this.clock, {
        status: 'invalid',
        chain_version: stateRow?.chain_version ?? null,
        schema_version: schemaVersion,
        anchor_sequence: stateRow?.anchor_sequence ?? null,
        anchor_hash: stateRow?.anchor_hash ?? null,
        head_sequence: stateRow?.head_sequence ?? null,
        head_hash: stateRow?.head_hash ?? null,
        verified_entries: verifiedEntries,
        retention_receipts: receiptCount,
        failure_code: code,
        failure_sequence: sequence,
      });

    try {
      const version = this.db
        .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM governance_schema_migrations')
        .get() as { version: number };
      schemaVersion = version.version;
      if (schemaVersion < GOVERNANCE_SCHEMA_VERSION) return fail('CHAIN_SCHEMA_MISSING');
      if (schemaVersion > GOVERNANCE_SCHEMA_VERSION) return fail('UNSUPPORTED_VERSION');

      stateRow = this.db
        .prepare('SELECT * FROM governance_audit_chain_state WHERE singleton_id = 1')
        .get() as AuditChainStateRow | undefined;
      if (!stateRow) return fail('STATE_MISSING');
      if (!validState(stateRow)) {
        return fail(
          stateRow.chain_version === AUDIT_CHAIN_VERSION ? 'MALFORMED_ROW' : 'UNSUPPORTED_VERSION'
        );
      }

      const receipts = this.db
        .prepare(
          'SELECT * FROM governance_audit_retention_receipts ORDER BY pruned_through_sequence ASC'
        )
        .all() as unknown as AuditRetentionReceiptRow[];
      receiptCount = receipts.length;
      const retention = verifyRetentionHistory(receipts, stateRow, this.trustedRetentionKeys);
      if (!retention.valid) {
        return fail(
          retention.failureCode ?? 'RETENTION_BOUNDARY_MISMATCH',
          retention.failureSequence ?? null
        );
      }

      const staleLinks = this.db
        .prepare('SELECT COUNT(*) AS count FROM governance_audit_chain WHERE sequence <= ?')
        .get(stateRow.anchor_sequence) as { count: number };
      if (staleLinks.count !== 0) return fail('RETENTION_BOUNDARY_MISMATCH');

      const links = this.db
        .prepare('SELECT * FROM governance_audit_chain ORDER BY sequence ASC')
        .all() as unknown as AuditChainRow[];
      const readEvent = this.db.prepare(`SELECT id, kind, intent_id, ts, actor, action, target,
        params, task_ref, status, result, error, duration_ms FROM audit_events WHERE id = ?`);
      let expectedSequence = stateRow.anchor_sequence + 1;
      let previousHash = stateRow.anchor_hash;
      for (const link of links) {
        if (
          !Number.isSafeInteger(link.sequence) ||
          link.sequence < 1 ||
          link.chain_version !== AUDIT_CHAIN_VERSION ||
          !SHA256_HEX.test(link.previous_hash) ||
          !SHA256_HEX.test(link.payload_hash) ||
          !SHA256_HEX.test(link.chain_hash)
        ) {
          return fail('MALFORMED_ROW', Number.isSafeInteger(link.sequence) ? link.sequence : null);
        }
        if (link.sequence !== expectedSequence) return fail('SEQUENCE_GAP', expectedSequence);
        if (link.previous_hash !== previousHash) {
          return fail('PREVIOUS_HASH_MISMATCH', link.sequence);
        }
        const event = readEvent.get(link.event_id) as AuditEventStorageRow | undefined;
        if (!event) return fail('MISSING_EVENT', link.sequence);
        const payloadHash = computeAuditPayloadHash(event, link.redaction_version);
        if (payloadHash !== link.payload_hash) return fail('PAYLOAD_HASH_MISMATCH', link.sequence);
        const chainHash = computeAuditChainHash(link.sequence, previousHash, payloadHash);
        if (chainHash !== link.chain_hash) return fail('CHAIN_HASH_MISMATCH', link.sequence);
        verifiedEntries += 1;
        expectedSequence += 1;
        previousHash = chainHash;
      }

      const unchained = this.db
        .prepare(`SELECT e.id FROM audit_events e LEFT JOIN governance_audit_chain c
          ON c.event_id = e.id WHERE c.event_id IS NULL LIMIT 1`)
        .get() as { id: string } | undefined;
      if (unchained) return fail('UNCHAINED_EVENT');
      if (expectedSequence - 1 !== stateRow.head_sequence || previousHash !== stateRow.head_hash) {
        return fail('HEAD_MISMATCH', stateRow.head_sequence || null);
      }

      return status(this.clock, {
        status: 'valid',
        chain_version: stateRow.chain_version,
        schema_version: schemaVersion,
        anchor_sequence: stateRow.anchor_sequence,
        anchor_hash: stateRow.anchor_hash,
        head_sequence: stateRow.head_sequence,
        head_hash: stateRow.head_hash,
        verified_entries: verifiedEntries,
        retention_receipts: receiptCount,
        failure_code: null,
        failure_sequence: null,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : '';
      return detail.includes('no such table')
        ? fail('CHAIN_SCHEMA_MISSING')
        : unavailable(this.clock);
    }
  }

  private appendStorageRow(row: AuditEventStorageRow, redactionVersion: string): void {
    const state = this.db
      .prepare('SELECT * FROM governance_audit_chain_state WHERE singleton_id = 1')
      .get() as AuditChainStateRow | undefined;
    if (!state || !validState(state)) throw new Error('Audit chain integrity unavailable');

    const unchained = this.db
      .prepare(`SELECT e.id FROM audit_events e LEFT JOIN governance_audit_chain c
        ON c.event_id = e.id WHERE c.event_id IS NULL LIMIT 1`)
      .get();
    if (unchained) throw new Error('Audit chain contains an unlinked event');
    if (state.head_sequence > state.anchor_sequence) {
      const head = this.db
        .prepare('SELECT event_id, chain_hash FROM governance_audit_chain WHERE sequence = ?')
        .get(state.head_sequence) as { event_id: string; chain_hash: string } | undefined;
      if (!head || head.chain_hash !== state.head_hash) {
        throw new Error('Audit chain head checkpoint is invalid');
      }
    }

    this.db
      .prepare(`INSERT INTO audit_events (
        id, kind, intent_id, ts, actor, action, target, params, task_ref,
        status, result, error, duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        row.id,
        row.kind,
        row.intent_id,
        row.ts,
        row.actor,
        row.action,
        row.target,
        row.params,
        row.task_ref,
        row.status,
        row.result,
        row.error,
        row.duration_ms
      );
    const sequence = state.head_sequence + 1;
    const payloadHash = computeAuditPayloadHash(row, redactionVersion);
    const chainHash = computeAuditChainHash(sequence, state.head_hash, payloadHash);
    const now = verifiedAt(this.clock);
    this.db
      .prepare(`INSERT INTO governance_audit_chain (
        sequence, event_id, chain_version, redaction_version, previous_hash,
        payload_hash, chain_hash, appended_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        sequence,
        row.id,
        AUDIT_CHAIN_VERSION,
        redactionVersion,
        state.head_hash,
        payloadHash,
        chainHash,
        now
      );
    const updated = this.db
      .prepare(`UPDATE governance_audit_chain_state SET head_sequence = ?, head_hash = ?,
        updated_at = ? WHERE singleton_id = 1 AND head_sequence = ? AND head_hash = ?`)
      .run(sequence, chainHash, now, state.head_sequence, state.head_hash);
    if (updated.changes !== 1) throw new Error('Audit chain head update raced another writer');
  }
}

export function inspectAuditIntegrity(
  options: AuditIntegrityInspectionOptions = {}
): AuditIntegrityStatus {
  const clock = options.clock ?? new SystemClock();
  const dbPath = resolveGovernanceDbPath(options.dbPath);
  if (dbPath === ':memory:' || !fs.existsSync(dbPath)) return unavailable(clock);
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec(`PRAGMA busy_timeout = ${GOVERNANCE_BUSY_TIMEOUT_MS};`);
    return new AuditChainStore(db, clock, options.trustedRetentionKeys).verifyIntegrity();
  } catch {
    return unavailable(clock);
  } finally {
    try {
      db?.close();
    } catch {
      // The typed unavailable result is sufficient for read-only inspection.
    }
  }
}
