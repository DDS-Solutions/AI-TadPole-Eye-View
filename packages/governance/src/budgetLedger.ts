import type { DatabaseSync } from 'node:sqlite';
import {
  type Actor,
  type AuditEntry,
  type BudgetLedger,
  LedgerFingerprintComponentsSchema,
  type LedgerInDoubtRequest,
  LedgerInDoubtRequestSchema,
  type LedgerOperation,
  type LedgerReconciliationRequest,
  LedgerReconciliationRequestSchema,
  type LedgerRecoveryResult,
  LedgerRecoveryResultSchema,
  type LedgerRefundRequest,
  LedgerRefundRequestSchema,
  type LedgerReservationRequest,
  LedgerReservationRequestSchema,
  type LedgerReservationResult,
  LedgerReservationResultSchema,
  type LedgerTerminalRequest,
  LedgerTerminalRequestSchema,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import { AuditChainStore } from './auditChainStore.js';
import type { TrustedAuditRetentionKey } from './auditRetention.js';
import { BudgetLedgerStore, type TenantBudgetRow } from './budgetLedgerStore.js';

import { openGovernanceDatabase, withImmediateTransaction } from './governanceDb.js';
import { LedgerOperationError, transitionRace, unavailableLedger } from './ledgerErrors.js';
import {
  createLedgerAuditOutcome,
  fingerprintLedgerComponents,
  reconciliationLedgerResult,
} from './ledgerSerialization.js';
import { toMicrousd } from './money.js';

export type CommittedAuditPublisher = (entry: AuditEntry) => void;

export { LedgerOperationError } from './ledgerErrors.js';

export interface SqliteBudgetLedgerOptions {
  dbPath?: string;
  clock?: SimClock;
  publishCommittedAudit?: CommittedAuditPublisher;
  db?: DatabaseSync;
  trustedRetentionKeys?: readonly TrustedAuditRetentionKey[];
}

export class SqliteBudgetLedger implements BudgetLedger {
  private readonly db: DatabaseSync;
  private readonly clock: SimClock;
  private readonly store: BudgetLedgerStore;
  private readonly publishCommittedAudit?: CommittedAuditPublisher;
  private closed = false;
  private readonly ownsDb: boolean;

  constructor(options: SqliteBudgetLedgerOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.publishCommittedAudit = options.publishCommittedAudit;
    this.ownsDb = options.db === undefined;
    this.db =
      options.db ?? openGovernanceDatabase({ dbPath: options.dbPath, clock: this.clock }).db;
    const integrity = new AuditChainStore(
      this.db,
      this.clock,
      options.trustedRetentionKeys
    ).verifyIntegrity();
    if (integrity.status !== 'valid') {
      if (this.ownsDb) this.db.close();
      throw new Error('Budget ledger unavailable because audit integrity verification failed');
    }
    this.store = new BudgetLedgerStore(this.db, this.clock);
  }

  reserve(input: LedgerReservationRequest): LedgerReservationResult {
    const request = LedgerReservationRequestSchema.parse(input);
    const components = LedgerFingerprintComponentsSchema.parse(request.fingerprint_components);
    const fingerprint = fingerprintLedgerComponents(components);
    const committed: AuditEntry[] = [];

    const result = this.transaction(() => {
      const existing = this.store.readOperationRow(request.operation_id);
      if (existing) return this.store.classifyExisting(existing, fingerprint);

      const now = this.store.isoNow();
      const activeSibling = this.store.readActiveOperationByFingerprint(fingerprint, now);
      if (activeSibling) return this.store.classifyExisting(activeSibling, fingerprint);

      const budget = this.store.readBudgetRow();
      const reserved = toMicrousd(components.estimate.max, 'estimate.max', true, 'up');
      committed.push(this.store.insertAuditIntent(request.audit_intent));

      // Global STASIS halts all operations regardless of tenant
      if (budget.stasis_active === 1) {
        const reason = (budget.trip_code ?? 'BUDGET_BREACH') as 'BUDGET_BREACH';
        const message = budget.stasis_message ?? 'System is locked in STASIS mode.';
        const { outcome, operation } = this.store.recordReservationDenial(
          request,
          fingerprint,
          reserved,
          now,
          reason,
          message,
          components.action
        );
        committed.push(this.store.insertAuditOutcome(outcome));
        return LedgerReservationResultSchema.parse({
          kind: 'denied',
          operation,
          reason,
          message,
        });
      }

      // Per-tenant budget isolation
      if (components.tenant_id) {
        const tenantBudget = this.store.ensureTenantBudget(components.tenant_id);
        const tenantHeld = this.store.activeHeldMicrousdForTenant(components.tenant_id);
        const tenantAvailable = Math.max(
          0,
          tenantBudget.cap_microusd - tenantBudget.spent_microusd - tenantHeld
        );

        if (tenantBudget.stasis_active === 1 || reserved > tenantAvailable) {
          const reason =
            tenantBudget.stasis_active === 1
              ? ((tenantBudget.trip_code ?? 'BUDGET_BREACH') as 'BUDGET_BREACH')
              : 'BUDGET_BREACH';
          const message =
            tenantBudget.stasis_active === 1
              ? (tenantBudget.stasis_message ??
                `Tenant '${components.tenant_id}' is locked in STASIS mode.`)
              : `Tenant '${components.tenant_id}' reservation requires ${reserved} micro-USD but only ${tenantAvailable} micro-USD remains.`;
          if (tenantBudget.stasis_active !== 1) {
            this.store.writeTenantTrip(components.tenant_id, 'BUDGET_BREACH', message);
          }
          const { outcome, operation } = this.store.recordReservationDenial(
            request,
            fingerprint,
            reserved,
            now,
            reason,
            message,
            components.action,
            { tenant_id: components.tenant_id }
          );
          committed.push(this.store.insertAuditOutcome(outcome));
          return LedgerReservationResultSchema.parse({
            kind: 'denied',
            operation,
            reason,
            message,
          });
        }

        this.store.insertOperation(request, fingerprint, reserved, now, 'RESERVED', null);
        this.store.insertLedgerEntry(request.operation_id, 'reserved', reserved, {
          available_before: tenantAvailable,
          tenant_id: components.tenant_id,
        });
        return LedgerReservationResultSchema.parse({
          kind: 'reserved',
          operation: this.store.readRequiredOperation(request.operation_id),
        });
      }

      // Legacy global budget check when tenant_id is null
      const held = this.store.activeHeldMicrousd();
      const available = Math.max(0, budget.cap_microusd - budget.spent_microusd - held);

      if (reserved > available) {
        const reason = 'BUDGET_BREACH';
        const message = `Reservation requires ${reserved} micro-USD but only ${available} micro-USD remains.`;
        this.store.writeTrip('BUDGET_BREACH', message);
        const { outcome, operation } = this.store.recordReservationDenial(
          request,
          fingerprint,
          reserved,
          now,
          reason,
          message,
          components.action
        );
        committed.push(this.store.insertAuditOutcome(outcome));
        return LedgerReservationResultSchema.parse({
          kind: 'denied',
          operation,
          reason,
          message,
        });
      }

      this.store.insertOperation(request, fingerprint, reserved, now, 'RESERVED', null);
      this.store.insertLedgerEntry(request.operation_id, 'reserved', reserved, {
        available_before: available,
      });
      return LedgerReservationResultSchema.parse({
        kind: 'reserved',
        operation: this.store.readRequiredOperation(request.operation_id),
      });
    });
    this.publish(committed);
    return result;
  }

  startExecution(operationId: string, requestFingerprint: string): LedgerOperation {
    return this.transaction(() => {
      const now = this.store.isoNow();
      const result = this.db
        .prepare(`
          UPDATE governance_budget_operations
          SET state = 'EXECUTING', execution_started_at = ?
          WHERE operation_id = ? AND request_fingerprint = ?
            AND state = 'RESERVED' AND deadline_at > ?
        `)
        .run(now, operationId, requestFingerprint, now);
      if (result.changes !== 1) {
        const operation = this.store.readRequiredOperation(operationId);
        if (operation.request_fingerprint !== requestFingerprint) {
          throw new LedgerOperationError('IDEMPOTENCY_CONFLICT', 'Operation fingerprint changed');
        }
        if (operation.state === 'RESERVED' && operation.deadline_at <= now) {
          throw new LedgerOperationError(
            'RESERVATION_EXPIRED',
            'Reservation expired before dispatch'
          );
        }
        throw new LedgerOperationError(
          'INVALID_LEDGER_TRANSITION',
          `Cannot dispatch operation in state ${operation.state}`
        );
      }
      this.store.insertLedgerEntry(operationId, 'executing', 0, null);
      return this.store.readRequiredOperation(operationId);
    });
  }

  settle(input: LedgerTerminalRequest): LedgerOperation {
    const request = LedgerTerminalRequestSchema.parse(input);
    return this.finish(request, 'SETTLED', null);
  }

  refund(input: LedgerRefundRequest): LedgerOperation {
    const request = LedgerRefundRequestSchema.parse(input);
    return this.finish(request, 'REFUNDED', request.evidence);
  }

  markInDoubt(input: LedgerInDoubtRequest): LedgerOperation {
    const request = LedgerInDoubtRequestSchema.parse(input);
    const committed: AuditEntry[] = [];
    const operation = this.transaction(() => {
      const current = this.store.readRequiredOperation(request.operation_id);
      this.assertFingerprint(current, request.request_fingerprint);
      if (current.state === 'IN_DOUBT') return current;
      if (current.state !== 'EXECUTING') {
        throw new LedgerOperationError(
          'INVALID_LEDGER_TRANSITION',
          `Cannot mark ${current.state} in doubt`
        );
      }
      const result = this.db
        .prepare(`
        UPDATE governance_budget_operations SET state = 'IN_DOUBT'
        WHERE operation_id = ? AND state = 'EXECUTING'
      `)
        .run(request.operation_id);
      if (result.changes !== 1) throw transitionRace();
      this.store.insertLedgerEntry(request.operation_id, 'in_doubt', current.reserved_microusd, {
        reason: request.reason,
      });
      this.store.writeTrip('COMPLIANCE_DRIFT', 'An executed operation has an ambiguous outcome.');
      committed.push(this.store.insertAuditOutcome(request.audit_outcome));
      return this.store.readRequiredOperation(request.operation_id);
    });
    this.publish(committed);
    return operation;
  }

  reconcile(input: LedgerReconciliationRequest, actor: 'human'): LedgerOperation {
    if (actor !== 'human') throw new Error('Ledger reconciliation requires a human actor');
    const request = LedgerReconciliationRequestSchema.parse(input);
    const committed: AuditEntry[] = [];
    const operation = this.transaction(() => {
      const current = this.store.readRequiredOperation(request.operation_id);
      const actual =
        request.resolution === 'settled'
          ? toMicrousd(request.actual_usd ?? 0, 'actual_usd', true, 'up')
          : 0;
      const desiredState = request.resolution === 'settled' ? 'SETTLED' : 'REFUNDED';
      if (current.state === desiredState) {
        if (
          current.settled_microusd === actual &&
          JSON.stringify(current.evidence) === JSON.stringify(request.evidence)
        ) {
          return current;
        }
        throw new LedgerOperationError(
          'IDEMPOTENCY_CONFLICT',
          'Terminal reconciliation differs from the durable resolution'
        );
      }
      if (current.state !== 'IN_DOUBT') {
        throw new LedgerOperationError(
          'INVALID_LEDGER_TRANSITION',
          `Cannot reconcile ${current.state}`
        );
      }
      committed.push(this.store.insertAuditIntent(request.audit_intent));
      const result = reconciliationLedgerResult(current, request.resolution, actual);
      const outcome = createLedgerAuditOutcome(
        request.audit_intent.id,
        this.store.isoNow(),
        'ok',
        result
      );
      this.store.applyTerminal(current, desiredState, actual, result, request.evidence);
      committed.push(this.store.insertAuditOutcome(outcome));
      return this.store.readRequiredOperation(request.operation_id);
    });
    this.publish(committed);
    return operation;
  }

  lookup(operationId: string): LedgerOperation | null {
    try {
      const row = this.store.readOperationRow(operationId);
      return row ? this.store.toOperation(row) : null;
    } catch (_error) {
      throw unavailableLedger();
    }
  }

  recoverExpired(): LedgerRecoveryResult {
    const refunded: string[] = [];
    const inDoubt: string[] = [];
    const committed: AuditEntry[] = [];
    this.transaction(() => {
      const now = this.store.isoNow();
      const rows = this.store.readExpiredOperations(now);
      for (const row of rows) {
        const current = this.store.toOperation(row);
        if (current.state === 'RESERVED') {
          const outcome = this.store.expireReserved(current, now);
          committed.push(this.store.insertAuditOutcome(outcome));
          refunded.push(current.operation_id);
        } else {
          const outcome = this.store.expireExecuting(current, now);
          committed.push(this.store.insertAuditOutcome(outcome));
          inDoubt.push(current.operation_id);
        }
      }
    });
    this.publish(committed);
    return LedgerRecoveryResultSchema.parse({
      refunded_operation_ids: refunded,
      in_doubt_operation_ids: inDoubt,
    });
  }

  hasInDoubt(): boolean {
    try {
      return this.store.hasInDoubt();
    } catch {
      throw unavailableLedger();
    }
  }

  getTenantBudget(tenantId: string): TenantBudgetRow {
    return this.transaction(() => this.store.ensureTenantBudget(tenantId));
  }

  getTenantHeldMicrousd(tenantId: string): number {
    return this.transaction(() => this.store.activeHeldMicrousdForTenant(tenantId));
  }

  setTenantCap(tenantId: string, capMicrousd: number): void {
    if (!Number.isSafeInteger(capMicrousd) || capMicrousd <= 0) {
      throw new Error('Tenant cap must be a positive integer micro-USD amount');
    }
    this.transaction(() => this.store.setTenantCap(tenantId, capMicrousd));
  }

  resumeTenant(tenantId: string, resumedBy: Actor = 'human'): void {
    if (resumedBy !== 'human') {
      throw new Error('STASIS resume requires a human actor');
    }
    this.transaction(() => this.store.resumeTenant(tenantId, resumedBy));
  }

  tripTenant(
    tenantId: string,
    reason: 'BUDGET_BREACH' | 'COMPLIANCE_DRIFT' = 'BUDGET_BREACH',
    message = 'Tenant quota exceeded'
  ): void {
    this.transaction(() => {
      this.store.ensureTenantBudget(tenantId);
      this.store.writeTenantTrip(tenantId, reason, message);
    });
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      if (this.ownsDb) {
        this.db.close();
      }
    }
  }

  private finish(
    request: LedgerTerminalRequest | LedgerRefundRequest,
    state: 'SETTLED' | 'REFUNDED',
    evidence: LedgerRefundRequest['evidence']
  ): LedgerOperation {
    const committed: AuditEntry[] = [];
    const operation = this.transaction(() => {
      const current = this.store.readRequiredOperation(request.operation_id);
      this.assertFingerprint(current, request.request_fingerprint);
      if (current.state === state) return current;
      const allowed =
        state === 'SETTLED'
          ? current.state === 'EXECUTING'
          : current.state === 'RESERVED' || current.state === 'EXECUTING';
      if (!allowed)
        throw new LedgerOperationError(
          'INVALID_LEDGER_TRANSITION',
          `Cannot ${state.toLowerCase()} ${current.state}`
        );
      if (state === 'REFUNDED' && current.state === 'EXECUTING' && !evidence) {
        throw new LedgerOperationError(
          'INVALID_LEDGER_TRANSITION',
          'Executing refund requires evidence of no effect and no charge'
        );
      }
      this.store.applyTerminal(
        current,
        state,
        state === 'SETTLED' ? request.actual_microusd : 0,
        request.terminal_result,
        evidence
      );
      const stored = this.store.readRequiredOperation(request.operation_id);
      const boundedOutcome = {
        ...request.audit_outcome,
        result: stored.terminal_result,
      };
      committed.push(this.store.insertAuditOutcome(boundedOutcome));
      return stored;
    });
    this.publish(committed);
    return operation;
  }

  private assertFingerprint(operation: LedgerOperation, fingerprint: string): void {
    if (operation.request_fingerprint !== fingerprint)
      throw new LedgerOperationError('IDEMPOTENCY_CONFLICT', 'Operation fingerprint changed');
  }

  private transaction<T>(operation: () => T): T {
    try {
      return withImmediateTransaction(this.db, operation);
    } catch (error) {
      if (error instanceof LedgerOperationError) throw error;
      throw unavailableLedger();
    }
  }

  private publish(entries: readonly AuditEntry[]): void {
    if (!this.publishCommittedAudit) return;
    for (const entry of entries) {
      try {
        this.publishCommittedAudit(entry);
      } catch {
        /* durable row is authoritative */
      }
    }
  }
}
