import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  type AtomicLedgerAuditIntent,
  type AtomicLedgerAuditOutcome,
  type LedgerOperation,
  LedgerOperationSchema,
  type LedgerRefundRequest,
  type LedgerReservationRequest,
  M3_FINGERPRINT_VERSION,
  M3_LEDGER_CONTRACT_VERSION,
} from '@gev/contracts';
import type { SimClock } from '@gev/core';
import { AuditChainStore } from './auditChainStore.js';
import { LedgerOperationError, transitionRace } from './ledgerErrors.js';
import { canonicalizeLedgerComponents, normalizeTerminalResult } from './ledgerSerialization.js';

export interface LedgerRow {
  operation_id: string;
  intent_id: string;
  contract_version: string;
  fingerprint_version: string;
  request_fingerprint: string;
  fingerprint_components_json: string;
  state: string;
  reserved_microusd: number;
  settled_microusd: number;
  period_start: string;
  deadline_at: string;
  created_at: string;
  execution_started_at: string | null;
  terminal_at: string | null;
  terminal_result_json: string | null;
  terminal_result_digest: string | null;
  evidence_json: string | null;
}

export interface BudgetRow {
  period_start: string;
  spent_microusd: number;
  cap_microusd: number;
  stasis_active: number;
  trip_code: string | null;
  stasis_message: string | null;
}

export class BudgetLedgerStore {
  private readonly auditChain: AuditChainStore;

  constructor(
    private readonly db: DatabaseSync,
    private readonly clock: SimClock
  ) {
    this.auditChain = new AuditChainStore(db, clock);
  }

  insertOperation(
    request: LedgerReservationRequest,
    fingerprint: string,
    reserved: number,
    now: string,
    state: 'RESERVED' | 'DENIED',
    terminalResult: unknown
  ): void {
    const normalized =
      terminalResult === null
        ? null
        : normalizeTerminalResult(request.operation_id, terminalResult);
    this.db
      .prepare(`INSERT INTO governance_budget_operations (
      operation_id, intent_id, contract_version, fingerprint_version, request_fingerprint,
      fingerprint_components_json, actor, tenant_id, action, task_ref, period_start, state,
      reserved_microusd, settled_microusd, deadline_at, created_at, execution_started_at,
      terminal_at, terminal_result_json, terminal_result_digest, evidence_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?, ?, NULL)`)
      .run(
        request.operation_id,
        request.audit_intent.id,
        M3_LEDGER_CONTRACT_VERSION,
        M3_FINGERPRINT_VERSION,
        fingerprint,
        canonicalizeLedgerComponents(request.fingerprint_components),
        request.fingerprint_components.actor,
        request.fingerprint_components.tenant_id,
        request.fingerprint_components.action,
        request.fingerprint_components.task_ref,
        this.readBudgetRow().period_start,
        state,
        reserved,
        request.deadline_at,
        now,
        state === 'DENIED' ? now : null,
        normalized?.json ?? null,
        normalized?.digest ?? null
      );
  }

  readOperationRow(operationId: string): LedgerRow | null {
    return (
      (this.db
        .prepare('SELECT * FROM governance_budget_operations WHERE operation_id = ?')
        .get(operationId) as LedgerRow | undefined) ?? null
    );
  }

  readRequiredOperation(operationId: string): LedgerOperation {
    const row = this.readOperationRow(operationId);
    if (!row) {
      throw new LedgerOperationError(
        'INVALID_LEDGER_TRANSITION',
        'Ledger operation does not exist'
      );
    }
    return this.toOperation(row);
  }

  toOperation(row: LedgerRow): LedgerOperation {
    return LedgerOperationSchema.parse({
      operation_id: row.operation_id,
      intent_id: row.intent_id,
      contract_version: row.contract_version,
      fingerprint_version: row.fingerprint_version,
      request_fingerprint: row.request_fingerprint,
      fingerprint_components: JSON.parse(row.fingerprint_components_json),
      state: row.state,
      reserved_microusd: row.reserved_microusd,
      settled_microusd: row.settled_microusd,
      period_start: row.period_start,
      deadline_at: row.deadline_at,
      created_at: row.created_at,
      execution_started_at: row.execution_started_at,
      terminal_at: row.terminal_at,
      terminal_result: row.terminal_result_json ? JSON.parse(row.terminal_result_json) : null,
      terminal_result_digest: row.terminal_result_digest,
      evidence: row.evidence_json ? JSON.parse(row.evidence_json) : null,
    });
  }

  readBudgetRow(): BudgetRow {
    const row = this.db
      .prepare('SELECT * FROM governance_budget_state WHERE singleton_id = 1')
      .get() as BudgetRow | undefined;
    if (!row) throw new Error('Durable governance budget state is missing');
    return row;
  }

  activeHeldMicrousd(): number {
    const row = this.db
      .prepare(`SELECT COALESCE(SUM(reserved_microusd), 0) AS held
      FROM governance_budget_operations WHERE state IN ('RESERVED', 'EXECUTING', 'IN_DOUBT')`)
      .get() as { held: number };
    if (!Number.isSafeInteger(row.held) || row.held < 0) {
      throw new Error('Active reservation sum is invalid');
    }
    return row.held;
  }

  insertLedgerEntry(operationId: string, event: string, amount: number, detail: unknown): void {
    this.db
      .prepare(`INSERT INTO governance_budget_ledger_entries
      (entry_id, operation_id, event_type, amount_microusd, recorded_at, detail_json)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        crypto.randomUUID(),
        operationId,
        event,
        amount,
        this.isoNow(),
        detail === null ? null : JSON.stringify(detail)
      );
  }

  insertAuditIntent(intent: AtomicLedgerAuditIntent): AtomicLedgerAuditIntent {
    return this.auditChain.appendIntent(intent);
  }

  insertAuditOutcome(outcome: AtomicLedgerAuditOutcome): AtomicLedgerAuditOutcome {
    return this.auditChain.appendOutcome(outcome);
  }

  writeTrip(reason: 'BUDGET_BREACH' | 'COMPLIANCE_DRIFT', message: string): void {
    this.db
      .prepare(`UPDATE governance_budget_state SET stasis_active = 1, trip_code = ?,
      trip_at = ?, resumed_by = NULL, stasis_message = ?, revision = revision + 1
      WHERE singleton_id = 1`)
      .run(reason, this.isoNow(), message);
  }

  applyTerminal(
    current: LedgerOperation,
    state: 'SETTLED' | 'REFUNDED',
    actual: number,
    rawResult: unknown,
    evidence: LedgerRefundRequest['evidence']
  ): void {
    const normalized = normalizeTerminalResult(current.operation_id, rawResult);
    const now = this.isoNow();
    const changed = this.db
      .prepare(`
      UPDATE governance_budget_operations SET state = ?, settled_microusd = ?, terminal_at = ?,
        terminal_result_json = ?, terminal_result_digest = ?, evidence_json = ?
      WHERE operation_id = ? AND state = ?
    `)
      .run(
        state,
        actual,
        now,
        normalized.json,
        normalized.digest,
        evidence ? JSON.stringify(evidence) : null,
        current.operation_id,
        current.state
      );
    if (changed.changes !== 1) throw transitionRace();
    if (state === 'SETTLED') this.recordSettlement(current, actual);
    this.insertLedgerEntry(current.operation_id, state.toLowerCase(), actual, evidence);
  }

  isoNow(): string {
    return new Date(this.clock.now()).toISOString();
  }

  private recordSettlement(current: LedgerOperation, actual: number): void {
    const budget = this.readBudgetRow();
    const spent = budget.spent_microusd + actual;
    if (!Number.isSafeInteger(spent)) {
      throw new Error('Settled spend is outside the supported micro-USD range');
    }
    let trip: 'BUDGET_BREACH' | 'COMPLIANCE_DRIFT' | null = null;
    if (spent >= budget.cap_microusd) trip = 'BUDGET_BREACH';
    else if (actual > current.reserved_microusd) trip = 'COMPLIANCE_DRIFT';
    const now = this.isoNow();
    const message = trip
      ? `Settlement recorded ${actual} micro-USD against a ${current.reserved_microusd} micro-USD reservation.`
      : budget.stasis_message;
    this.db
      .prepare(`UPDATE governance_budget_state SET spent_microusd = ?,
      stasis_active = CASE WHEN ? IS NULL THEN stasis_active ELSE 1 END,
      trip_code = COALESCE(?, trip_code), trip_at = CASE WHEN ? IS NULL THEN trip_at ELSE ? END,
      resumed_by = CASE WHEN ? IS NULL THEN resumed_by ELSE NULL END,
      stasis_message = ?, revision = revision + 1 WHERE singleton_id = 1
    `)
      .run(spent, trip, trip, trip, now, trip, message);
  }
}
