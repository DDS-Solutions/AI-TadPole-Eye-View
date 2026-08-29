import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { type SimClock, SystemClock } from '@gev/core';
import { migrateAuditChain } from './auditChainMigration.js';

export const GOVERNANCE_SCHEMA_VERSION = 4;
export const GOVERNANCE_BUSY_TIMEOUT_MS = 5_000;

export interface GovernanceDatabaseOptions {
  dbPath?: string;
  clock?: SimClock;
}

export function resolveGovernanceDbPath(dbPath?: string): string {
  if (dbPath) {
    return dbPath === ':memory:' ? dbPath : path.resolve(dbPath);
  }

  const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  if (isTest) {
    return ':memory:';
  }

  const configuredPath =
    process.env.GEV_GOVERNANCE_DB ??
    process.env.GEV_AUDIT_DB ??
    path.join(process.env.GEV_DATA_DIR || '.gev', 'audit.sqlite');
  return path.resolve(configuredPath);
}

function ensureDatabaseParent(dbPath: string): void {
  if (dbPath === ':memory:') {
    return;
  }

  const parentDir = path.dirname(dbPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }
}

function rollbackQuietly(db: DatabaseSync): void {
  try {
    db.exec('ROLLBACK;');
  } catch {
    // Preserve the original persistence failure.
  }
}

function migrateGovernanceDatabase(db: DatabaseSync, clock: SimClock): void {
  db.exec('BEGIN IMMEDIATE;');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS governance_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const versionRow = db
      .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM governance_schema_migrations')
      .get() as { version: number };

    if (versionRow.version > GOVERNANCE_SCHEMA_VERSION) {
      throw new Error(
        `Governance database schema ${versionRow.version} is newer than supported version ${GOVERNANCE_SCHEMA_VERSION}`
      );
    }

    if (versionRow.version < 1) {
      db.exec(`
        CREATE TABLE governance_budget_state (
          singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
          period_start TEXT NOT NULL,
          spent_microusd INTEGER NOT NULL CHECK (spent_microusd >= 0),
          cap_microusd INTEGER NOT NULL CHECK (cap_microusd > 0),
          warn_threshold_pct INTEGER NOT NULL CHECK (warn_threshold_pct BETWEEN 1 AND 100),
          stasis_active INTEGER NOT NULL CHECK (stasis_active IN (0, 1)),
          trip_code TEXT CHECK (
            trip_code IS NULL OR trip_code IN ('BUDGET_BREACH', 'LOGIC_BLOCKER', 'COMPLIANCE_DRIFT')
          ),
          trip_at TEXT,
          resumed_by TEXT CHECK (resumed_by IS NULL OR resumed_by = 'human'),
          stasis_message TEXT,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          CHECK (
            (trip_code IS NULL AND trip_at IS NULL) OR
            (trip_code IS NOT NULL AND trip_at IS NOT NULL)
          ),
          CHECK (stasis_active = 0 OR trip_code IS NOT NULL)
        );
        INSERT INTO governance_schema_migrations (version, applied_at)
        VALUES (1, '${new Date(clock.now()).toISOString()}');
      `);
    }

    if (versionRow.version < 2) {
      db.exec(`
        CREATE TABLE governance_approval_nonces (
          nonce TEXT PRIMARY KEY,
          request_id TEXT NOT NULL UNIQUE,
          intent_id TEXT NOT NULL,
          signer_id TEXT NOT NULL,
          key_id TEXT NOT NULL,
          consumed_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
        CREATE INDEX governance_approval_nonces_expiry_idx
          ON governance_approval_nonces (expires_at);
        INSERT INTO governance_schema_migrations (version, applied_at)
        VALUES (2, '${new Date(clock.now()).toISOString()}');
      `);
    }

    if (versionRow.version < 3) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_events (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          intent_id TEXT,
          ts TEXT NOT NULL,
          actor TEXT,
          action TEXT,
          target TEXT,
          params TEXT,
          task_ref TEXT,
          status TEXT,
          result TEXT,
          error TEXT,
          duration_ms INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_audit_task ON audit_events(task_ref);
        CREATE INDEX IF NOT EXISTS idx_audit_intent ON audit_events(intent_id);
        CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_events(actor);
        CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_events(ts);

        CREATE TABLE governance_budget_operations (
          operation_id TEXT PRIMARY KEY,
          intent_id TEXT NOT NULL UNIQUE,
          contract_version TEXT NOT NULL CHECK (contract_version = 'gev.m3.ledger.v1'),
          fingerprint_version TEXT NOT NULL CHECK (fingerprint_version = 'gev.m3.fingerprint.v1'),
          request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint) = 64),
          fingerprint_components_json TEXT NOT NULL,
          actor TEXT NOT NULL CHECK (actor IN ('ai', 'human', 'system')),
          tenant_id TEXT,
          action TEXT NOT NULL,
          task_ref TEXT NOT NULL,
          period_start TEXT NOT NULL,
          state TEXT NOT NULL CHECK (
            state IN ('RESERVED', 'EXECUTING', 'SETTLED', 'REFUNDED', 'IN_DOUBT', 'DENIED')
          ),
          reserved_microusd INTEGER NOT NULL CHECK (
            reserved_microusd BETWEEN 0 AND 9007199254740991
          ),
          settled_microusd INTEGER NOT NULL CHECK (
            settled_microusd BETWEEN 0 AND 9007199254740991
          ),
          deadline_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          execution_started_at TEXT,
          terminal_at TEXT,
          terminal_result_json TEXT,
          terminal_result_digest TEXT CHECK (
            terminal_result_digest IS NULL OR length(terminal_result_digest) = 64
          ),
          evidence_json TEXT,
          CHECK (operation_id = intent_id),
          CHECK (
            (state IN ('SETTLED', 'REFUNDED', 'DENIED') AND terminal_at IS NOT NULL) OR
            (state NOT IN ('SETTLED', 'REFUNDED', 'DENIED') AND terminal_at IS NULL)
          ),
          CHECK (state <> 'EXECUTING' OR execution_started_at IS NOT NULL),
          CHECK (state <> 'SETTLED' OR terminal_result_json IS NOT NULL),
          CHECK (state <> 'REFUNDED' OR settled_microusd = 0),
          CHECK (state <> 'DENIED' OR settled_microusd = 0)
        );
        CREATE INDEX governance_budget_operations_state_idx
          ON governance_budget_operations (state);
        CREATE INDEX governance_budget_operations_deadline_idx
          ON governance_budget_operations (deadline_at);

        CREATE TABLE governance_budget_ledger_entries (
          entry_id TEXT PRIMARY KEY,
          operation_id TEXT NOT NULL REFERENCES governance_budget_operations(operation_id),
          event_type TEXT NOT NULL CHECK (
            event_type IN ('reserved', 'executing', 'settled', 'refunded', 'in_doubt', 'denied')
          ),
          amount_microusd INTEGER NOT NULL CHECK (
            amount_microusd BETWEEN 0 AND 9007199254740991
          ),
          recorded_at TEXT NOT NULL,
          detail_json TEXT,
          UNIQUE (operation_id, event_type)
        );
        CREATE INDEX governance_budget_ledger_entries_operation_idx
          ON governance_budget_ledger_entries (operation_id);

        CREATE TRIGGER governance_budget_terminal_immutable
        BEFORE UPDATE ON governance_budget_operations
        WHEN OLD.state IN ('SETTLED', 'REFUNDED', 'DENIED')
        BEGIN
          SELECT RAISE(ABORT, 'terminal ledger operation is immutable');
        END;

        CREATE TRIGGER governance_budget_transition_guard
        BEFORE UPDATE OF state ON governance_budget_operations
        WHEN NOT (
          (OLD.state = 'RESERVED' AND NEW.state IN ('EXECUTING', 'REFUNDED')) OR
          (OLD.state = 'EXECUTING' AND NEW.state IN ('SETTLED', 'REFUNDED', 'IN_DOUBT')) OR
          (OLD.state = 'IN_DOUBT' AND NEW.state IN ('SETTLED', 'REFUNDED'))
        )
        BEGIN
          SELECT RAISE(ABORT, 'invalid ledger state transition');
        END;

        INSERT INTO governance_schema_migrations (version, applied_at)
        VALUES (3, '${new Date(clock.now()).toISOString()}');
      `);
    }

    if (versionRow.version < 4) {
      migrateAuditChain(db, new Date(clock.now()).toISOString());
    }

    db.exec('COMMIT;');
  } catch (error) {
    rollbackQuietly(db);
    throw error;
  }
}

export function openGovernanceDatabase(options: GovernanceDatabaseOptions = {}): {
  db: DatabaseSync;
  dbPath: string;
} {
  const clock = options.clock ?? new SystemClock();
  const dbPath = resolveGovernanceDbPath(options.dbPath);
  ensureDatabaseParent(dbPath);

  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath);
    db.exec(`PRAGMA busy_timeout = ${GOVERNANCE_BUSY_TIMEOUT_MS};`);
    db.exec('PRAGMA foreign_keys = ON;');
    if (dbPath !== ':memory:') {
      db.exec('PRAGMA journal_mode = WAL;');
      db.exec('PRAGMA synchronous = NORMAL;');
    }
    migrateGovernanceDatabase(db, clock);
    return { db, dbPath };
  } catch (error) {
    try {
      db?.close();
    } catch {
      // Preserve the original persistence failure.
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Governance database unavailable; refusing process-local fallback: ${detail}`);
  }
}

export function withImmediateTransaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = operation();
    db.exec('COMMIT;');
    return result;
  } catch (error) {
    rollbackQuietly(db);
    throw error;
  }
}
