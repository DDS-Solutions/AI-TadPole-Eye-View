import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  type AuditEntry,
  type AuditIntegrityStatus,
  type AuditIntent,
  type AuditOutcome,
  type AuditQuery,
  AuditQuery as AuditQuerySchema,
  type AuditSink,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import { type AuditEventStorageRow, auditStorageRowToEntry } from './auditChainHash.js';
import {
  AuditChainStore,
  type AuditIntegrityInspectionOptions,
  inspectAuditIntegrity,
} from './auditChainStore.js';
import { redactAuditText } from './auditRedaction.js';
import type {
  AuditRetentionPolicy,
  AuditRetentionRequest,
  AuditRetentionResult,
  TrustedAuditRetentionKey,
} from './auditRetention.js';
import { openGovernanceDatabase, withImmediateTransaction } from './governanceDb.js';

export interface SqliteAuditSinkOptions {
  dbPath?: string;
  clock?: SimClock;
  db?: DatabaseSync;
  integrityMode?: 'enforce' | 'inspect';
  trustedRetentionKeys?: readonly TrustedAuditRetentionKey[];
  retentionPolicy?: AuditRetentionPolicy;
}

/**
 * SQLite WAL Audit Sink (Rule 1 & ADR-0016)
 * Backed by Node 24 built-in node:sqlite module for dependency-free durability.
 */
export class SqliteAuditSink implements AuditSink {
  public readonly clock: SimClock;
  private readonly db: DatabaseSync;
  private readonly chainStore: AuditChainStore;
  private readonly retentionPolicy: AuditRetentionPolicy;
  private readonly listeners: Set<(entry: AuditEntry) => void> = new Set();
  private readonly ownsDb: boolean;
  private closed = false;

  constructor(options: SqliteAuditSinkOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.ownsDb = options.db === undefined;
    this.db =
      options.db ?? openGovernanceDatabase({ dbPath: options.dbPath, clock: this.clock }).db;
    this.chainStore = new AuditChainStore(this.db, this.clock, options.trustedRetentionKeys);
    this.retentionPolicy = options.retentionPolicy ?? {};
    if (options.integrityMode !== 'inspect') {
      const integrity = this.chainStore.verifyIntegrity();
      if (integrity.status !== 'valid') {
        if (this.ownsDb) this.db.close();
        throw new Error(
          `Audit integrity verification failed closed: ${integrity.failure_code ?? 'UNKNOWN'}`
        );
      }
    }
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

  /** Best-effort notification for an audit row committed by the local ledger unit-of-work. */
  publishCommitted(entry: AuditEntry): void {
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // The durable SQLite row is authoritative; notification is best effort.
      }
    }
  }

  /**
   * MUST be called before executing the described action.
   */
  intent(i: AuditIntent): void {
    const intent = withImmediateTransaction(this.db, () => this.chainStore.appendIntent(i));
    this.publishCommitted(intent);
  }

  /**
   * MUST be called after execution, whatever the result.
   */
  outcome(o: AuditOutcome): void {
    const outcome = withImmediateTransaction(this.db, () => this.chainStore.appendOutcome(o));
    this.publishCommitted(outcome);
  }

  verifyIntegrity(): AuditIntegrityStatus {
    return this.chainStore.verifyIntegrity();
  }

  retain(request: AuditRetentionRequest): AuditRetentionResult {
    const intentId = crypto.randomUUID();
    const startedAt = this.clock.now();
    const intent = withImmediateTransaction(this.db, () =>
      this.chainStore.appendIntent({
        kind: 'audit.intent',
        id: intentId,
        ts: new Date(startedAt).toISOString(),
        actor: request.actor,
        action: 'governance.audit.retain',
        target: 'audit.chain',
        params: {
          prune_through_sequence: request.pruneThroughSequence,
          reason: request.reason,
          signer_id: request.signer.signerId,
          key_id: request.signer.keyId,
        },
        task_ref: 'human-audit-retention',
      })
    );
    this.publishCommitted(intent);

    try {
      let outcome!: AuditOutcome;
      const result = withImmediateTransaction(this.db, () => {
        const retained = this.chainStore.retain(request, this.retentionPolicy);
        outcome = this.chainStore.appendOutcome({
          kind: 'audit.outcome',
          intent_id: intentId,
          ts: new Date(this.clock.now()).toISOString(),
          status: 'ok',
          result: {
            receipt_id: retained.receiptId,
            pruned_entries: retained.prunedEntries,
            anchor_sequence: retained.anchorSequence,
          },
          duration_ms: Math.max(0, this.clock.now() - startedAt),
        });
        return retained;
      });
      this.publishCommitted(outcome);
      return result;
    } catch (error) {
      const safeError = redactAuditText(
        error instanceof Error ? error.message : 'Audit retention failed closed',
        1_024
      );
      const outcome = withImmediateTransaction(this.db, () =>
        this.chainStore.appendOutcome({
          kind: 'audit.outcome',
          intent_id: intentId,
          ts: new Date(this.clock.now()).toISOString(),
          status: 'blocked',
          error: safeError,
          duration_ms: Math.max(0, this.clock.now() - startedAt),
        })
      );
      this.publishCommitted(outcome);
      throw new Error(safeError);
    }
  }

  /**
   * Tails audit entries matching the query criteria.
   */
  tail(q?: AuditQuery): AuditEntry[] {
    const query = q ? AuditQuerySchema.parse(q) : { limit: 100 };
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (query.actor) {
      conditions.push('actor = ?');
      params.push(query.actor);
    }
    if (query.action_prefix) {
      conditions.push('action LIKE ?');
      params.push(`${query.action_prefix}%`);
    }
    if (query.since) {
      conditions.push('ts >= ?');
      params.push(query.since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM audit_events ${where} ORDER BY rowid DESC LIMIT ?`;
    params.push(query.limit ?? 100);

    const rows = this.db.prepare(sql).all(...params) as unknown as AuditEventStorageRow[];
    const entries = rows.map(auditStorageRowToEntry);

    // Reverse to chronological order (we fetched newest-first for correct tail)
    return entries.reverse();
  }

  /**
   * Helper: Tails entries filtered by task_ref.
   */
  tailByTaskRef(taskRef: string): AuditEntry[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM audit_events WHERE task_ref = ? OR intent_id IN (SELECT id FROM audit_events WHERE task_ref = ?) ORDER BY rowid ASC'
      )
      .all(taskRef, taskRef) as unknown as AuditEventStorageRow[];
    return rows.map(auditStorageRowToEntry);
  }

  /**
   * Closes SQLite database connection.
   */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.ownsDb) {
      this.db.close();
    }
  }
}

export { inspectAuditIntegrity };
export type { AuditIntegrityInspectionOptions };
