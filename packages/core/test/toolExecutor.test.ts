import type {
  ApprovalGate,
  ApprovalResult,
  AuditEntry,
  AuditSink,
  BudgetGovernor,
  BudgetLedger,
  Verdict,
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

function createAuditSink(
  entries: AuditEntry[] = [],
  events?: string[]
): AuditSink & { entries: AuditEntry[] } {
  return {
    entries,
    intent: (intent) => {
      events?.push('intent');
      entries.push(intent);
    },
    outcome: (outcome) => {
      events?.push('outcome');
      entries.push(outcome);
    },
    tail: () => [...entries],
  };
}

function createBudgetGovernor(
  verdict: Verdict = { allowed: true, remaining_usd: 10 },
  events?: string[]
): BudgetGovernor {
  return {
    check: () => {
      events?.push('budget');
      return verdict;
    },
    trip: () => {},
    state: () => ({
      period_start: '2024-01-01T00:00:00.000Z',
      cap_usd: 10,
      spent_usd: 0,
      warn_threshold_pct: 80,
      stasis_active: !verdict.allowed,
      last_trip: verdict.allowed ? null : { code: verdict.reason, at: '2024-01-01T00:00:00.000Z' },
    }),
  };
}

function createApprovalGate(events?: string[]): ApprovalGate {
  return {
    request: async (request) => {
      events?.push('approval');
      return {
        request_id: request.id,
        decision: 'approved',
        signature: 'test-signature',
        decided_by: 'human',
        decided_at: request.ts,
      };
    },
  };
}

function createExecutor(
  options: {
    auditSink?: AuditSink;
    approvalGate?: ApprovalGate;
    budgetGovernor?: BudgetGovernor;
    budgetLedger?: BudgetLedger;
    allowedTools?: readonly ['set_flag'];
    events?: string[];
  } = {}
): GovernedToolExecutor {
  const auditSink = options.auditSink ?? createAuditSink();
  const entries = 'entries' in auditSink ? auditSink.entries : undefined;
  return new GovernedToolExecutor({
    auditSink,
    approvalGate: options.approvalGate ?? createApprovalGate(),
    budgetGovernor: options.budgetGovernor ?? createBudgetGovernor(),
    budgetLedger: options.budgetLedger ?? new TestBudgetLedger({ entries, events: options.events }),
    allowedTools: options.allowedTools,
    clock: new FrozenClock(1_700_000_000_000),
    idFactory: createIdFactory(),
  });
}

describe('GovernedToolExecutor unified lifecycle', () => {
  it('owns intent, durable check, approval, one handler dispatch, output validation, and outcome', async () => {
    const events: string[] = [];
    const auditSink = createAuditSink([], events);
    const recordSpend = vi.fn();
    const budgetGovernor = {
      ...createBudgetGovernor({ allowed: true, remaining_usd: 10 }, events),
      recordSpend,
    };
    const executor = createExecutor({
      auditSink,
      approvalGate: createApprovalGate(events),
      budgetGovernor,
      events,
    });
    const handler = vi.fn((input: { flag: string; enabled: boolean }) => {
      events.push('handler');
      return { ...input, updated: true };
    });
    executor.register('set_flag', handler);

    const result = await executor.execute(
      'set_flag',
      { flag: 'opensky.enabled', enabled: false },
      { actor: 'ai', task_ref: 'task-5.1.2-test' }
    );

    expect(result).toMatchObject({
      success: true,
      status: 'ok',
      tool: 'set_flag',
      result: { flag: 'opensky.enabled', enabled: false, updated: true },
    });
    expect(events).toEqual(['intent', 'approval', 'budget', 'handler', 'outcome']);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(auditSink.entries).toHaveLength(2);
    expect(auditSink.entries[0]).toMatchObject({
      kind: 'audit.intent',
      action: 'tool.set_flag',
      task_ref: 'task-5.1.2-test',
    });
    expect(auditSink.entries[1]).toMatchObject({ kind: 'audit.outcome', status: 'ok' });
    expect(recordSpend).not.toHaveBeenCalled();
  });

  it('rejects invalid input before handler or audit and never emits an orphan outcome', async () => {
    const auditSink = createAuditSink();
    const handler = vi.fn(() => ({ layer: 'flights', enabled: true, updated: true }));
    const executor = createExecutor({ auditSink });
    executor.register('toggle_layer', handler);

    const result = await executor.execute('toggle_layer', { layer: '', enabled: true });

    expect(result).toMatchObject({ success: false, code: 'INPUT_VALIDATION_FAILED' });
    expect(handler).not.toHaveBeenCalled();
    expect(auditSink.entries).toEqual([]);
  });

  it('fails closed before audit when any governance port or handler is missing', async () => {
    const noPorts = new GovernedToolExecutor({
      clock: new FrozenClock(1_700_000_000_000),
      idFactory: createIdFactory(),
    });
    noPorts.register('toggle_layer', (input) => ({ ...input, updated: true }));
    const missingPorts = await noPorts.execute('toggle_layer', {
      layer: 'flights',
      enabled: true,
    });
    expect(missingPorts).toMatchObject({
      success: false,
      code: 'MISSING_GOVERNANCE_PORT',
    });

    const auditSink = createAuditSink();
    const missingHandler = await createExecutor({ auditSink }).execute('toggle_layer', {
      layer: 'flights',
      enabled: true,
    });
    expect(missingHandler).toMatchObject({ success: false, code: 'MISSING_HANDLER' });
    expect(auditSink.entries).toEqual([]);
  });

  it('does not emit an outcome when audit intent storage fails for an unreserved read', async () => {
    const outcome = vi.fn();
    const executor = createExecutor({
      auditSink: {
        intent: () => {
          throw new Error('audit database unavailable');
        },
        outcome,
        tail: () => [],
      },
    });
    const handler = vi.fn(() => ({
      cap_usd: 10,
      spent_usd: 0,
      remaining_usd: 10,
      stasis_active: false,
      governance_authority: {
        kind: 'process_local' as const,
        authoritative: false,
        schema_version: 3,
        state_revision: 0,
      },
    }));
    executor.register('get_budget', handler);

    const result = await executor.execute('get_budget', {});

    expect(result).toMatchObject({ success: false, code: 'AUDIT_INTENT_FAILED' });
    expect(handler).not.toHaveBeenCalled();
    expect(outcome).not.toHaveBeenCalled();
  });

  it('normalizes STASIS/budget denial after exactly one intent and one blocked outcome', async () => {
    const auditSink = createAuditSink();
    const handler = vi.fn((input: { flag: string; enabled: boolean }) => ({
      ...input,
      updated: true,
    }));
    const executor = createExecutor({
      auditSink,
      budgetLedger: new TestBudgetLedger({ entries: auditSink.entries, deny: true }),
    });
    executor.register('set_flag', handler);

    const result = await executor.execute('set_flag', {
      flag: 'opensky.enabled',
      enabled: false,
    });

    expect(result).toMatchObject({
      success: false,
      status: 'blocked',
      blocked: true,
      code: 'BUDGET_DENIED',
    });
    expect(handler).not.toHaveBeenCalled();
    expect(auditSink.entries.map((entry) => entry.kind)).toEqual(['audit.intent', 'audit.outcome']);
    expect(auditSink.entries[1]).toMatchObject({ status: 'blocked' });
  });

  it('normalizes approval verification failure before dispatch with one error outcome', async () => {
    const auditSink = createAuditSink();
    const ledger = new TestBudgetLedger({ entries: auditSink.entries });
    const handler = vi.fn((input: { flag: string; enabled: boolean }) => ({
      ...input,
      updated: true,
    }));
    const executor = createExecutor({
      auditSink,
      approvalGate: {
        request: async () => {
          throw new Error('signed approval replay detected');
        },
      },
      budgetLedger: ledger,
    });
    executor.register('set_flag', handler);

    const result = await executor.execute('set_flag', {
      flag: 'opensky.enabled',
      enabled: false,
    });

    expect(result).toMatchObject({
      success: false,
      status: 'error',
      code: 'APPROVAL_UNAVAILABLE',
    });
    expect(handler).not.toHaveBeenCalled();
    expect(ledger.lookup(result.intent_id)?.state).toBe('REFUNDED');
    expect(auditSink.entries.map((entry) => entry.kind)).toEqual(['audit.intent', 'audit.outcome']);
    expect(auditSink.entries[1]).toMatchObject({ status: 'error' });
  });

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
    const executor = createExecutor({ auditSink, approvalGate, budgetLedger: ledger });
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
    const executor = createExecutor({ auditSink, budgetLedger: ledger });
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

  it('reuses one operation ID for terminal replay without redispatch or double settlement', async () => {
    const auditSink = createAuditSink();
    const ledger = new TestBudgetLedger({ entries: auditSink.entries });
    const executor = createExecutor({ auditSink, budgetLedger: ledger });
    const handler = vi.fn((input: { layer: string; enabled: boolean }) => ({
      ...input,
      updated: true,
    }));
    executor.register('toggle_layer', handler);
    const operationId = '00000000-0000-4000-8000-000000000099';

    const first = await executor.execute(
      'toggle_layer',
      { layer: 'flights', enabled: true },
      { operation_id: operationId }
    );
    const replay = await executor.execute(
      'toggle_layer',
      { layer: 'flights', enabled: true },
      { operation_id: operationId }
    );
    const conflict = await executor.execute(
      'toggle_layer',
      { layer: 'ships', enabled: true },
      { operation_id: operationId }
    );

    expect(first.success).toBe(true);
    expect(replay).toMatchObject({ success: true, replayed: true, intent_id: operationId });
    expect(conflict).toMatchObject({ success: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(ledger.lookup(operationId)).toMatchObject({
      state: 'SETTLED',
      reserved_microusd: 0,
      settled_microusd: 0,
    });
    expect(auditSink.entries).toHaveLength(2);
  });

  it('marks a post-dispatch handler timeout IN_DOUBT and never retries the handler', async () => {
    vi.useFakeTimers();
    try {
      const ledger = new TestBudgetLedger();
      const executor = createExecutor({ budgetLedger: ledger });
      const handler = vi.fn(() => new Promise(() => {}));
      executor.register('toggle_layer', handler);
      const operationId = '00000000-0000-4000-8000-000000000098';
      const pending = executor.execute(
        'toggle_layer',
        { layer: 'flights', enabled: true },
        { operation_id: operationId }
      );
      await vi.advanceTimersByTimeAsync(30_001);
      const result = await pending;

      expect(result).toMatchObject({ code: 'OPERATION_IN_DOUBT', retryable: false });
      expect(ledger.lookup(operationId)?.state).toBe('IN_DOUBT');
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    {
      label: 'handler exception',
      expectedCode: 'OPERATION_IN_DOUBT',
      handler: () => {
        throw new Error('handler exploded');
      },
    },
    {
      label: 'invalid handler output',
      expectedCode: 'OUTPUT_VALIDATION_FAILED',
      handler: () => ({ updated: true }),
    },
  ])('normalizes $label and records one error outcome', async ({ expectedCode, handler }) => {
    const auditSink = createAuditSink();
    const executor = createExecutor({ auditSink });
    executor.register('toggle_layer', handler);

    const result = await executor.execute('toggle_layer', {
      layer: 'flights',
      enabled: true,
    });

    expect(result).toMatchObject({ success: false, status: 'error', code: expectedCode });
    expect(auditSink.entries).toHaveLength(2);
    expect(auditSink.entries[1]).toMatchObject({ status: 'error' });
  });

  it('enforces consumer capability filters before action', async () => {
    const auditSink = createAuditSink();
    const executor = createExecutor({ auditSink, allowedTools: ['set_flag'] });
    executor.register('set_flag', (input) => ({ ...input, updated: true }));

    expect(() =>
      executor.register('toggle_layer', (input) => ({ ...input, updated: true }))
    ).toThrow("outside this consumer's capability set");
    const result = await executor.execute('toggle_layer', {
      layer: 'flights',
      enabled: true,
    });
    expect(result).toMatchObject({ success: false, code: 'TOOL_UNAVAILABLE' });
    expect(auditSink.entries).toEqual([]);
  });

  it('carries immutable remote identity context through one governed dispatch', async () => {
    const auditSink = createAuditSink();
    const executor = createExecutor({ auditSink });
    const handler = vi.fn((input, context) => ({ ...input, updated: true, context }));
    executor.register('set_flag', handler);
    const operationId = '00000000-0000-4000-8000-000000000063';

    const result = await executor.execute(
      'set_flag',
      { flag: 'opensky.enabled', enabled: false },
      {
        actor: 'ai',
        principal: 'svc:tadpole-test',
        tenant_id: 'tenant-test',
        task_ref: 'task-6.3-test',
        operation_id: operationId,
      }
    );

    expect(result.success).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[1]).toEqual({
      actor: 'ai',
      principal: 'svc:tadpole-test',
      tenant_id: 'tenant-test',
      task_ref: 'task-6.3-test',
      operation_id: operationId,
    });
    expect(auditSink.entries).toHaveLength(2);
    expect(auditSink.entries[0]).toMatchObject({
      actor: 'ai',
      task_ref: 'task-6.3-test',
    });
  });
});
