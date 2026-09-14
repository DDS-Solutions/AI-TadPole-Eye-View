import type {
  ApprovalGate,
  ApprovalResult,
  AuditEntry,
  AuditSink,
  BudgetGovernor,
} from '@gev/contracts';
import { describe, expect, it, vi } from 'vitest';
import { FrozenClock, GovernedToolExecutor } from '../src/index.js';
import { TestBudgetLedger } from './budgetLedgerFixture.js';

function createIdFactory(): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
  };
}

function createAuditSink(): AuditSink & { entries: AuditEntry[] } {
  const entries: AuditEntry[] = [];
  return {
    entries,
    intent: (intent) => entries.push(intent),
    outcome: (outcome) => entries.push(outcome),
    tail: () => [...entries],
  };
}

function createBudgetGovernor(): BudgetGovernor {
  return {
    check: () => ({ allowed: true, remaining_usd: 10 }),
    trip: () => {},
    state: () => ({
      period_start: '2024-01-01T00:00:00.000Z',
      cap_usd: 10,
      spent_usd: 0,
      warn_threshold_pct: 80,
      stasis_active: false,
      last_trip: null,
    }),
  };
}

function createExecutor(
  auditSink: AuditSink,
  approvalGate: ApprovalGate,
  budgetLedger: TestBudgetLedger
): GovernedToolExecutor {
  return new GovernedToolExecutor({
    auditSink,
    approvalGate,
    budgetGovernor: createBudgetGovernor(),
    budgetLedger,
    clock: new FrozenClock(1_700_000_000_000),
    idFactory: createIdFactory(),
  });
}

function approvingGate(): ApprovalGate {
  return {
    request: async (request) => ({
      request_id: request.id,
      decision: 'approved',
      signature: 'test-signature',
      decided_by: 'human',
      decided_at: request.ts,
    }),
  };
}

describe('GovernedToolExecutor cancellation lifecycle', () => {
  it('refunds and replays a cancellation received while approval is pending', async () => {
    const auditSink = createAuditSink();
    const ledger = new TestBudgetLedger({ entries: auditSink.entries });
    let approvalRequested!: () => void;
    const approvalStarted = new Promise<void>((resolve) => {
      approvalRequested = resolve;
    });
    let resolveApproval!: (approval: ApprovalResult) => void;
    const approvalDecision = new Promise<ApprovalResult>((resolve) => {
      resolveApproval = resolve;
    });
    const approvalGate: ApprovalGate = {
      request: (request) => {
        approvalRequested();
        return approvalDecision.then((approval) => ({ ...approval, request_id: request.id }));
      },
    };
    const approval = vi.spyOn(approvalGate, 'request');
    const handler = vi.fn((input: { flag: string; enabled: boolean }) => ({
      ...input,
      updated: true,
    }));
    const executor = createExecutor(auditSink, approvalGate, ledger);
    executor.register('set_flag', handler);
    const operationId = '00000000-0000-4000-8000-000000000096';
    const controller = new AbortController();

    const pending = executor.execute(
      'set_flag',
      { flag: 'opensky.enabled', enabled: false },
      { operation_id: operationId, signal: controller.signal }
    );
    await approvalStarted;
    controller.abort('client disconnected');
    const cancelled = await pending;

    expect(cancelled).toMatchObject({
      success: false,
      status: 'error',
      code: 'REQUEST_CANCELLED',
      retryable: false,
      intent_id: operationId,
    });
    expect(handler).not.toHaveBeenCalled();
    expect(ledger.lookup(operationId)).toMatchObject({
      state: 'REFUNDED',
      settled_microusd: 0,
      terminal_result: { code: 'REQUEST_CANCELLED' },
    });
    expect(auditSink.entries.map((entry) => entry.kind)).toEqual(['audit.intent', 'audit.outcome']);
    expect(auditSink.entries[1]).toMatchObject({ status: 'error' });

    resolveApproval({
      request_id: 'replaced-by-gate',
      decision: 'approved',
      signature: 'late-test-signature',
      decided_by: 'human',
      decided_at: '2024-01-01T00:00:00.000Z',
    });
    await Promise.resolve();
    const replay = await executor.execute(
      'set_flag',
      { flag: 'opensky.enabled', enabled: false },
      { operation_id: operationId }
    );

    expect(replay).toMatchObject({ code: 'REQUEST_CANCELLED', replayed: true });
    expect(approval).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
    expect(auditSink.entries).toHaveLength(2);
  });

  it('marks post-dispatch cancellation in doubt and stays pending until the handler stops', async () => {
    const auditSink = createAuditSink();
    const ledger = new TestBudgetLedger({ entries: auditSink.entries });
    const executor = createExecutor(auditSink, approvingGate(), ledger);
    const controller = new AbortController();
    let handlerStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      handlerStarted = resolve;
    });
    let finishHandler!: (output: { layer: string; enabled: boolean; updated: boolean }) => void;
    const handlerOutput = new Promise<{ layer: string; enabled: boolean; updated: boolean }>(
      (resolve) => {
        finishHandler = resolve;
      }
    );
    const handler = vi.fn((_input: { layer: string; enabled: boolean }, context) => {
      expect(context.signal).toBe(controller.signal);
      handlerStarted();
      return handlerOutput;
    });
    executor.register('toggle_layer', handler);
    const operationId = '00000000-0000-4000-8000-000000000095';

    let executionSettled = false;
    const pending = executor
      .execute(
        'toggle_layer',
        { layer: 'flights', enabled: true },
        { operation_id: operationId, signal: controller.signal }
      )
      .then((result) => {
        executionSettled = true;
        return result;
      });
    await started;
    controller.abort('client disconnected');
    await vi.waitFor(() => expect(ledger.lookup(operationId)?.state).toBe('IN_DOUBT'));

    expect(executionSettled).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
    finishHandler({ layer: 'flights', enabled: true, updated: true });
    const result = await pending;
    const replay = await executor.execute(
      'toggle_layer',
      { layer: 'flights', enabled: true },
      { operation_id: operationId }
    );

    expect(result).toMatchObject({ code: 'OPERATION_IN_DOUBT', retryable: false });
    expect(replay).toMatchObject({ code: 'OPERATION_IN_DOUBT', retryable: false });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(auditSink.entries.map((entry) => entry.kind)).toEqual(['audit.intent', 'audit.outcome']);
  });
});
