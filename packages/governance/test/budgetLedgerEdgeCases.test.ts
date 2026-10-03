import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  GevEvents,
  type LedgerReservationRequest,
  M3_FINGERPRINT_VERSION,
  M3_LEDGER_CONTRACT_VERSION,
} from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteBudgetLedger } from '../src/budgetLedger.js';
import { createGovernanceRuntimeContext } from '../src/runtimeContext.js';

const tempDirectories: string[] = [];
const START = Date.parse('2026-08-28T12:00:00.000Z');

function tempDatabase(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-ledger-edge-'));
  tempDirectories.push(directory);
  return path.join(directory, 'governance.sqlite');
}

function request(
  clock: FrozenClock,
  operationId: string,
  maxUsd: number,
  input: unknown = { value: 1 },
  deadlineOffsetMs = 30_000
): LedgerReservationRequest {
  const common = {
    actor: 'ai' as const,
    action: 'tool.test_mutation',
    params: input,
    task_ref: 'task-5.1.4-test',
  };
  return {
    operation_id: operationId,
    fingerprint_components: {
      contract_version: M3_LEDGER_CONTRACT_VERSION,
      fingerprint_version: M3_FINGERPRINT_VERSION,
      actor: common.actor,
      tenant_id: null,
      action: common.action,
      input,
      task_ref: common.task_ref,
      is_mutating: true,
      estimate: { currency: 'usd', min: 0, max: maxUsd },
    },
    deadline_at: new Date(clock.now() + deadlineOffsetMs).toISOString(),
    audit_intent: {
      kind: GevEvents.AuditIntent,
      id: operationId,
      ts: clock.iso(),
      target: 'test_mutation',
      ...common,
    },
  };
}

function outcome(clock: FrozenClock, operationId: string, result: unknown) {
  return {
    kind: GevEvents.AuditOutcome,
    intent_id: operationId,
    ts: clock.iso(),
    status: 'ok' as const,
    result,
    duration_ms: 0,
  };
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe('M3 durable budget ledger edge cases & STASIS scoping', () => {
  it('scopes ambiguous outcome STASIS trip to tenant without locking global budget (G-02)', () => {
    const clock = new FrozenClock(START);
    const runtime = createGovernanceRuntimeContext({ dbPath: tempDatabase(), clock, capUsd: 10 });
    try {
      runtime.budgetLedger.setTenantCap('tenant-isolated', 1_000_000);
      const operationId = crypto.randomUUID();
      const req = request(clock, operationId, 0.0001, { feed: 'flights' });
      req.fingerprint_components.tenant_id = 'tenant-isolated';
      const res = runtime.budgetLedger.reserve(req);
      expect(res.kind).toBe('reserved');
      if (res.kind !== 'reserved') throw new Error('expected reservation');

      runtime.budgetLedger.startExecution(operationId, res.operation.request_fingerprint);
      runtime.budgetLedger.markInDoubt({
        operation_id: operationId,
        request_fingerprint: res.operation.request_fingerprint,
        reason: 'Upstream timeout',
        audit_outcome: outcome(clock, operationId, { error: 'timeout' }),
      });

      // Tenant budget entered STASIS
      const tenantBudget = runtime.budgetLedger.getTenantBudget('tenant-isolated');
      expect(tenantBudget.stasis_active).toBe(1);
      expect(tenantBudget.trip_code).toBe('COMPLIANCE_DRIFT');

      // Global platform budget remains active (stasis_active is false)
      expect(runtime.budgetGovernor.state().stasis_active).toBe(false);

      // Other tenant remains active
      runtime.budgetLedger.setTenantCap('tenant-other', 1_000_000);
      const otherBudget = runtime.budgetLedger.getTenantBudget('tenant-other');
      expect(otherBudget.stasis_active).toBe(0);
    } finally {
      runtime.close();
    }
  });

  it('enforces foreign keys and runs migrations on an injected database connection (G-06)', () => {
    const clock = new FrozenClock(START);
    const bareDb = new DatabaseSync(':memory:');
    try {
      const ledger = new SqliteBudgetLedger({ db: bareDb, clock });
      // Assert PRAGMA foreign_keys is ON
      const fkCheck = bareDb.prepare('PRAGMA foreign_keys;').get() as { foreign_keys: number };
      expect(fkCheck.foreign_keys).toBe(1);

      // Assert migrations ran by verifying table existence
      const tables = bareDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='governance_budget_operations'"
        )
        .get();
      expect(tables).toBeDefined();

      ledger.close();
    } finally {
      bareDb.close();
    }
  });

  it('handles idempotency retry after execution timeout gracefully without creating duplicate operations or tripping STASIS (C-03)', () => {
    const clock = new FrozenClock(START);
    const runtime = createGovernanceRuntimeContext({ clock, dbPath: ':memory:', capUsd: 1 });
    try {
      const op1Id = crypto.randomUUID();
      const req1 = request(clock, op1Id, 0.1, { tenant_id: 'tenant-retry' }, 1_000);
      const res1 = runtime.budgetLedger.reserve(req1);
      expect(res1.kind).toBe('reserved');
      if (res1.kind !== 'reserved') throw new Error('expected reservation');

      runtime.budgetLedger.startExecution(op1Id, res1.operation.request_fingerprint);

      // Advance clock past the 1,000ms deadline
      clock.setTime(START + 1_500);

      // Client retries with identical request payload (same fingerprint, different op UUID)
      const op2Id = crypto.randomUUID();
      const req2 = request(clock, op2Id, 0.1, { tenant_id: 'tenant-retry' }, 1_000);
      const res2 = runtime.budgetLedger.reserve(req2);

      // Should return 'in_doubt' recognizing the existing unresolved timed-out operation
      expect(res2.kind).toBe('in_doubt');

      // STASIS should NOT be active yet (it is not tripped merely by retrying)
      expect(runtime.budgetGovernor.state().stasis_active).toBe(false);

      // Only one operation exists, and res2 returns the existing operation
      expect(res2.operation.operation_id).toBe(op1Id);
      expect(runtime.budgetLedger.lookup(op1Id)).toBeDefined();
      expect(runtime.budgetLedger.lookup(op2Id)).toBeNull();
    } finally {
      runtime.close();
    }
  });

  it('trips global STASIS for BUDGET_BREACH when platform spend meets or exceeds global cap (C-13)', () => {
    const clock = new FrozenClock(START);
    // 0.5 USD global cap
    const runtime = createGovernanceRuntimeContext({ clock, dbPath: ':memory:', capUsd: 0.5 });
    try {
      const opId = crypto.randomUUID();
      const res = runtime.budgetLedger.reserve(
        request(clock, opId, 0.5) // platform operation without tenant_id
      );
      expect(res.kind).toBe('reserved');
      if (res.kind !== 'reserved') throw new Error('expected reservation');

      runtime.budgetLedger.startExecution(opId, res.operation.request_fingerprint);
      runtime.budgetLedger.settle({
        operation_id: opId,
        request_fingerprint: res.operation.request_fingerprint,
        actual_microusd: 500_000,
        terminal_result: { success: true },
        audit_outcome: outcome(clock, opId, { success: true }),
      });

      // Global STASIS should now be tripped for BUDGET_BREACH because aggregate platform spend reached cap
      expect(runtime.budgetGovernor.state().stasis_active).toBe(true);
      expect(runtime.budgetGovernor.state().last_trip?.code).toBe('BUDGET_BREACH');
    } finally {
      runtime.close();
    }
  });
});
