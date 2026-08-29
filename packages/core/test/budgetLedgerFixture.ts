import crypto from 'node:crypto';
import type {
  AuditEntry,
  BudgetLedger,
  LedgerInDoubtRequest,
  LedgerOperation,
  LedgerReconciliationRequest,
  LedgerRefundRequest,
  LedgerReservationRequest,
  LedgerReservationResult,
  LedgerTerminalRequest,
} from '@gev/contracts';

export interface TestLedgerOptions {
  entries?: AuditEntry[];
  events?: string[];
  deny?: boolean;
}

export class TestBudgetLedger implements BudgetLedger {
  private readonly operations = new Map<string, LedgerOperation>();

  constructor(private readonly options: TestLedgerOptions = {}) {}

  reserve(request: LedgerReservationRequest): LedgerReservationResult {
    const fingerprint = crypto
      .createHash('sha256')
      .update(JSON.stringify(request.fingerprint_components))
      .digest('hex');
    const existing = this.operations.get(request.operation_id);
    if (existing) {
      if (existing.request_fingerprint !== fingerprint) {
        return { kind: 'conflict', operation: existing, message: 'fingerprint conflict' };
      }
      if (existing.state === 'IN_DOUBT') return { kind: 'in_doubt', operation: existing };
      if (existing.state === 'RESERVED' || existing.state === 'EXECUTING') {
        return { kind: 'in_progress', operation: existing };
      }
      return { kind: 'replay', operation: existing };
    }
    this.options.events?.push('intent');
    this.options.entries?.push(request.audit_intent);
    const denied = this.options.deny === true;
    const terminalResult = denied
      ? {
          success: false,
          status: 'blocked' as const,
          blocked: true,
          tool: request.fingerprint_components.action.slice(5),
          intent_id: request.operation_id,
          code: 'BUDGET_DENIED',
          error: 'STASIS active',
          duration_ms: 0,
        }
      : null;
    const operation: LedgerOperation = {
      operation_id: request.operation_id,
      intent_id: request.operation_id,
      contract_version: 'gev.m3.ledger.v1',
      fingerprint_version: 'gev.m3.fingerprint.v1',
      request_fingerprint: fingerprint,
      fingerprint_components: request.fingerprint_components,
      state: denied ? 'DENIED' : 'RESERVED',
      reserved_microusd: Math.ceil(request.fingerprint_components.estimate.max * 1_000_000),
      settled_microusd: 0,
      period_start: request.audit_intent.ts,
      deadline_at: request.deadline_at,
      created_at: request.audit_intent.ts,
      execution_started_at: null,
      terminal_at: denied ? request.audit_intent.ts : null,
      terminal_result: terminalResult,
      terminal_result_digest: denied ? 'a'.repeat(64) : null,
      evidence: null,
    };
    this.operations.set(request.operation_id, operation);
    if (denied) this.recordOutcome(request.audit_intent.ts, operation, 'blocked');
    return denied
      ? { kind: 'denied', operation, reason: 'BUDGET_BREACH', message: 'STASIS active' }
      : { kind: 'reserved', operation };
  }

  startExecution(operationId: string, requestFingerprint: string): LedgerOperation {
    const operation = this.required(operationId, requestFingerprint);
    const executing = {
      ...operation,
      state: 'EXECUTING' as const,
      execution_started_at: operation.created_at,
    };
    this.operations.set(operationId, executing);
    this.options.events?.push('budget');
    return executing;
  }

  settle(request: LedgerTerminalRequest): LedgerOperation {
    const operation = this.required(request.operation_id, request.request_fingerprint);
    const settled = {
      ...operation,
      state: 'SETTLED' as const,
      settled_microusd: request.actual_microusd,
      terminal_at: request.audit_outcome.ts,
      terminal_result: request.terminal_result,
      terminal_result_digest: 'b'.repeat(64),
    };
    this.operations.set(request.operation_id, settled);
    this.options.events?.push('outcome');
    this.options.entries?.push(request.audit_outcome);
    return settled;
  }

  refund(request: LedgerRefundRequest): LedgerOperation {
    const operation = this.required(request.operation_id, request.request_fingerprint);
    const refunded = {
      ...operation,
      state: 'REFUNDED' as const,
      settled_microusd: 0,
      terminal_at: request.audit_outcome.ts,
      terminal_result: request.terminal_result,
      terminal_result_digest: 'c'.repeat(64),
      evidence: request.evidence,
    };
    this.operations.set(request.operation_id, refunded);
    this.options.events?.push('outcome');
    this.options.entries?.push(request.audit_outcome);
    return refunded;
  }

  markInDoubt(request: LedgerInDoubtRequest): LedgerOperation {
    const operation = this.required(request.operation_id, request.request_fingerprint);
    const ambiguous = { ...operation, state: 'IN_DOUBT' as const };
    this.operations.set(request.operation_id, ambiguous);
    this.options.events?.push('outcome');
    this.options.entries?.push(request.audit_outcome);
    return ambiguous;
  }

  reconcile(_request: LedgerReconciliationRequest, _actor: 'human'): LedgerOperation {
    throw new Error('Not needed by core executor tests');
  }

  lookup(operationId: string): LedgerOperation | null {
    return this.operations.get(operationId) ?? null;
  }

  recoverExpired() {
    return { refunded_operation_ids: [], in_doubt_operation_ids: [] };
  }

  hasInDoubt(): boolean {
    return [...this.operations.values()].some((operation) => operation.state === 'IN_DOUBT');
  }

  private required(operationId: string, fingerprint: string): LedgerOperation {
    const operation = this.operations.get(operationId);
    if (!operation || operation.request_fingerprint !== fingerprint)
      throw new Error('missing operation');
    return operation;
  }

  private recordOutcome(ts: string, operation: LedgerOperation, status: 'blocked'): void {
    this.options.events?.push('outcome');
    this.options.entries?.push({
      kind: 'audit.outcome',
      intent_id: operation.intent_id,
      ts,
      status,
      result: operation.terminal_result,
    });
  }
}
