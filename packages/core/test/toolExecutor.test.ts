import type { ApprovalGate, AuditEntry, AuditSink, BudgetGovernor, Verdict } from '@gev/contracts';
import { describe, expect, it, vi } from 'vitest';
import { FrozenClock, GovernedToolExecutor } from '../src/index.js';

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
    allowedTools?: readonly ['set_flag'];
  } = {}
): GovernedToolExecutor {
  return new GovernedToolExecutor({
    auditSink: options.auditSink ?? createAuditSink(),
    approvalGate: options.approvalGate ?? createApprovalGate(),
    budgetGovernor: options.budgetGovernor ?? createBudgetGovernor(),
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
    expect(events).toEqual(['intent', 'budget', 'approval', 'handler', 'outcome']);
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

  it('does not emit an outcome when audit intent storage fails', async () => {
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
    const handler = vi.fn((input: { layer: string; enabled: boolean }) => ({
      ...input,
      updated: true,
    }));
    executor.register('toggle_layer', handler);

    const result = await executor.execute('toggle_layer', { layer: 'flights', enabled: true });

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
      budgetGovernor: createBudgetGovernor({
        allowed: false,
        reason: 'BUDGET_BREACH',
        message: 'STASIS active',
      }),
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

  it.each([
    {
      label: 'handler exception',
      expectedCode: 'HANDLER_ERROR',
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
});
