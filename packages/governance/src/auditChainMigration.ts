import type { DatabaseSync } from 'node:sqlite';
import {
  AUDIT_CHAIN_VERSION,
  AUDIT_LEGACY_REDACTION_VERSION,
  AUDIT_RETENTION_FORMAT_VERSION,
} from '@gev/contracts';
import {
  AUDIT_GENESIS_HASH,
  type AuditEventStorageRow,
  computeAuditChainHash,
  computeAuditPayloadHash,
} from './auditChainHash.js';

export const AUDIT_CHAIN_SCHEMA_VERSION = 4;

export function migrateAuditChain(db: DatabaseSync, appliedAt: string): void {
  db.exec(`
    CREATE TABLE governance_audit_retention_receipts (
      receipt_id TEXT PRIMARY KEY,
      format TEXT NOT NULL CHECK (format = '${AUDIT_RETENTION_FORMAT_VERSION}'),
      chain_version TEXT NOT NULL CHECK (chain_version = '${AUDIT_CHAIN_VERSION}'),
      previous_receipt_id TEXT REFERENCES governance_audit_retention_receipts(receipt_id),
      previous_anchor_sequence INTEGER NOT NULL CHECK (previous_anchor_sequence >= 0),
      previous_anchor_hash TEXT NOT NULL CHECK (length(previous_anchor_hash) = 64),
      pruned_through_sequence INTEGER NOT NULL UNIQUE CHECK (pruned_through_sequence > 0),
      pruned_through_hash TEXT NOT NULL CHECK (length(pruned_through_hash) = 64),
      retained_from_sequence INTEGER NOT NULL CHECK (retained_from_sequence > 0),
      head_sequence INTEGER NOT NULL CHECK (head_sequence >= pruned_through_sequence),
      head_hash TEXT NOT NULL CHECK (length(head_hash) = 64),
      approved_at TEXT NOT NULL,
      approved_by TEXT NOT NULL CHECK (approved_by = 'human'),
      reason TEXT NOT NULL,
      signer_id TEXT NOT NULL,
      key_id TEXT NOT NULL,
      algorithm TEXT NOT NULL CHECK (algorithm = 'Ed25519'),
      signature TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      CHECK (retained_from_sequence = pruned_through_sequence + 1)
    );

    CREATE TABLE governance_audit_chain_state (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      chain_version TEXT NOT NULL CHECK (chain_version = '${AUDIT_CHAIN_VERSION}'),
      genesis_hash TEXT NOT NULL CHECK (length(genesis_hash) = 64),
      anchor_sequence INTEGER NOT NULL CHECK (anchor_sequence >= 0),
      anchor_hash TEXT NOT NULL CHECK (length(anchor_hash) = 64),
      head_sequence INTEGER NOT NULL CHECK (head_sequence >= anchor_sequence),
      head_hash TEXT NOT NULL CHECK (length(head_hash) = 64),
      last_retention_receipt_id TEXT REFERENCES governance_audit_retention_receipts(receipt_id),
      updated_at TEXT NOT NULL,
      CHECK (
        (anchor_sequence = 0 AND anchor_hash = genesis_hash AND last_retention_receipt_id IS NULL) OR
        (anchor_sequence > 0 AND last_retention_receipt_id IS NOT NULL)
      )
    );

    CREATE TABLE governance_audit_chain (
      sequence INTEGER PRIMARY KEY CHECK (sequence > 0),
      event_id TEXT NOT NULL UNIQUE REFERENCES audit_events(id) ON DELETE RESTRICT,
      chain_version TEXT NOT NULL CHECK (chain_version = '${AUDIT_CHAIN_VERSION}'),
      redaction_version TEXT NOT NULL,
      previous_hash TEXT NOT NULL CHECK (length(previous_hash) = 64),
      payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
      chain_hash TEXT NOT NULL UNIQUE CHECK (length(chain_hash) = 64),
      appended_at TEXT NOT NULL
    );
    CREATE INDEX governance_audit_chain_event_idx ON governance_audit_chain(event_id);

    CREATE TABLE governance_audit_mutation_guard (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      retention_active INTEGER NOT NULL CHECK (retention_active IN (0, 1))
    );
    INSERT INTO governance_audit_mutation_guard (singleton_id, retention_active) VALUES (1, 0);

    CREATE TRIGGER governance_audit_events_immutable_update
    BEFORE UPDATE ON audit_events
    BEGIN SELECT RAISE(ABORT, 'audit events are immutable'); END;

    CREATE TRIGGER governance_audit_events_delete_guard
    BEFORE DELETE ON audit_events
    WHEN (SELECT retention_active FROM governance_audit_mutation_guard WHERE singleton_id = 1) = 0
    BEGIN SELECT RAISE(ABORT, 'audit events are append only'); END;

    CREATE TRIGGER governance_audit_chain_immutable_update
    BEFORE UPDATE ON governance_audit_chain
    BEGIN SELECT RAISE(ABORT, 'audit chain links are immutable'); END;

    CREATE TRIGGER governance_audit_chain_delete_guard
    BEFORE DELETE ON governance_audit_chain
    WHEN (SELECT retention_active FROM governance_audit_mutation_guard WHERE singleton_id = 1) = 0
    BEGIN SELECT RAISE(ABORT, 'audit chain links are append only'); END;

    CREATE TRIGGER governance_audit_receipts_immutable_update
    BEFORE UPDATE ON governance_audit_retention_receipts
    BEGIN SELECT RAISE(ABORT, 'audit retention receipts are immutable'); END;

    CREATE TRIGGER governance_audit_receipts_immutable_delete
    BEFORE DELETE ON governance_audit_retention_receipts
    BEGIN SELECT RAISE(ABORT, 'audit retention receipts are immutable'); END;
  `);

  const rows = db
    .prepare(`SELECT id, kind, intent_id, ts, actor, action, target, params, task_ref,
      status, result, error, duration_ms FROM audit_events ORDER BY rowid ASC`)
    .all() as unknown as AuditEventStorageRow[];
  const insertLink = db.prepare(`INSERT INTO governance_audit_chain (
    sequence, event_id, chain_version, redaction_version, previous_hash,
    payload_hash, chain_hash, appended_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

  let previousHash = AUDIT_GENESIS_HASH;
  let sequence = 0;
  for (const row of rows) {
    sequence += 1;
    const payloadHash = computeAuditPayloadHash(row, AUDIT_LEGACY_REDACTION_VERSION);
    const chainHash = computeAuditChainHash(sequence, previousHash, payloadHash);
    insertLink.run(
      sequence,
      row.id,
      AUDIT_CHAIN_VERSION,
      AUDIT_LEGACY_REDACTION_VERSION,
      previousHash,
      payloadHash,
      chainHash,
      appliedAt
    );
    previousHash = chainHash;
  }

  db.prepare(`INSERT INTO governance_audit_chain_state (
    singleton_id, chain_version, genesis_hash, anchor_sequence, anchor_hash,
    head_sequence, head_hash, last_retention_receipt_id, updated_at
  ) VALUES (1, ?, ?, 0, ?, ?, ?, NULL, ?)`).run(
    AUDIT_CHAIN_VERSION,
    AUDIT_GENESIS_HASH,
    AUDIT_GENESIS_HASH,
    sequence,
    previousHash,
    appliedAt
  );
  db.prepare('INSERT INTO governance_schema_migrations (version, applied_at) VALUES (4, ?)').run(
    appliedAt
  );
}
