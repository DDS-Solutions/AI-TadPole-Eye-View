import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { type SimClock, SystemClock } from '@gev/core';

export const GOVERNANCE_SCHEMA_VERSION = 1;
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
