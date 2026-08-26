import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  type AuditEntry,
  type AuditIntent,
  AuditIntent as AuditIntentSchema,
  type AuditOutcome,
  AuditOutcome as AuditOutcomeSchema,
  type AuditQuery,
  AuditQuery as AuditQuerySchema,
  type AuditSink,
  GevEvents,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';

export interface SqliteAuditSinkOptions {
  dbPath?: string;
  clock?: SimClock;
}

export interface SqliteAuditRow {
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

/**
 * SQLite WAL Audit Sink (Rule 1 & ADR-0016)
 * Backed by Node 24 built-in node:sqlite module for dependency-free durability.
 */
export class SqliteAuditSink implements AuditSink {
  public readonly clock: SimClock;
  private readonly db: DatabaseSync;
  private readonly listeners: Set<(entry: AuditEntry) => void> = new Set();

  constructor(options: SqliteAuditSinkOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    const dbPath = options.dbPath ?? ':memory:';

    if (dbPath !== ':memory:') {
      const parentDir = path.dirname(dbPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(dbPath);

    // Initialize WAL and schema
    if (dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA synchronous = NORMAL;');
    }

    this.db.exec(`
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
    `);
  }

  /**
   * Subscribes to real-time audit events. Returns an unsubscribe callback.
   */
  subscribe(listener: (entry: AuditEntry) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * MUST be called before executing the described action.
   */
  intent(i: AuditIntent): void {
    const intent = AuditIntentSchema.parse(i);
    const insertStmt = this.db.prepare(`
      INSERT INTO audit_events (
        id, kind, ts, actor, action, target, params, task_ref
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run(
      intent.id,
      intent.kind,
      intent.ts,
      intent.actor,
      intent.action,
      intent.target,
      intent.params !== undefined ? JSON.stringify(intent.params) : null,
      intent.task_ref
    );

    for (const listener of this.listeners) {
      try {
        listener(intent);
      } catch {
        // Prevent listener failures from blocking audit writes
      }
    }
  }

  /**
   * MUST be called after execution, whatever the result.
   */
  outcome(o: AuditOutcome): void {
    const outcome = AuditOutcomeSchema.parse(o);
    const rowId = crypto.randomUUID();
    const insertStmt = this.db.prepare(`
      INSERT INTO audit_events (
        id, kind, intent_id, ts, status, result, error, duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run(
      rowId,
      outcome.kind,
      outcome.intent_id,
      outcome.ts,
      outcome.status,
      outcome.result !== undefined ? JSON.stringify(outcome.result) : null,
      outcome.error ?? null,
      outcome.duration_ms ?? null
    );

    for (const listener of this.listeners) {
      try {
        listener(outcome);
      } catch {
        // Prevent listener failures from blocking audit writes
      }
    }
  }

  /**
   * Tails audit entries matching the query criteria.
   */
  tail(q?: AuditQuery): AuditEntry[] {
    const query = q ? AuditQuerySchema.parse(q) : { limit: 100 };
    const rows = this.db
      .prepare('SELECT * FROM audit_events ORDER BY rowid ASC LIMIT ?')
      .all(query.limit) as unknown as SqliteAuditRow[];

    const entries: AuditEntry[] = [];

    for (const row of rows) {
      if (row.kind === GevEvents.AuditIntent) {
        entries.push({
          kind: GevEvents.AuditIntent,
          id: row.id,
          ts: row.ts,
          actor: row.actor as 'ai' | 'human' | 'system',
          action: row.action ?? '',
          target: row.target ?? '',
          params: row.params ? JSON.parse(row.params) : undefined,
          task_ref: row.task_ref ?? '',
        });
      } else if (row.kind === GevEvents.AuditOutcome) {
        entries.push({
          kind: GevEvents.AuditOutcome,
          intent_id: row.intent_id ?? row.id,
          ts: row.ts,
          status: row.status as 'ok' | 'error' | 'blocked',
          result: row.result ? JSON.parse(row.result) : undefined,
          error: row.error ?? undefined,
          duration_ms: row.duration_ms ?? undefined,
        });
      }
    }

    return entries;
  }

  /**
   * Helper: Tails entries filtered by task_ref.
   */
  tailByTaskRef(taskRef: string): AuditEntry[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM audit_events WHERE task_ref = ? OR intent_id IN (SELECT id FROM audit_events WHERE task_ref = ?) ORDER BY rowid ASC'
      )
      .all(taskRef, taskRef) as unknown as SqliteAuditRow[];

    const entries: AuditEntry[] = [];

    for (const row of rows) {
      if (row.kind === GevEvents.AuditIntent) {
        entries.push({
          kind: GevEvents.AuditIntent,
          id: row.id,
          ts: row.ts,
          actor: row.actor as 'ai' | 'human' | 'system',
          action: row.action ?? '',
          target: row.target ?? '',
          params: row.params ? JSON.parse(row.params) : undefined,
          task_ref: row.task_ref ?? '',
        });
      } else if (row.kind === GevEvents.AuditOutcome) {
        entries.push({
          kind: GevEvents.AuditOutcome,
          intent_id: row.intent_id ?? row.id,
          ts: row.ts,
          status: row.status as 'ok' | 'error' | 'blocked',
          result: row.result ? JSON.parse(row.result) : undefined,
          error: row.error ?? undefined,
          duration_ms: row.duration_ms ?? undefined,
        });
      }
    }

    return entries;
  }

  /**
   * Closes SQLite database connection.
   */
  close(): void {
    this.db.close();
  }
}
