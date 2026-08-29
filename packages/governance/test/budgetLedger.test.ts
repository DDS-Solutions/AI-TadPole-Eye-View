import { spawn } from 'node:child_process';
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
  MAX_LEDGER_RESULT_BYTES,
} from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { CapBudgetGovernor } from '../src/budgetGovernor.js';
import { LedgerOperationError, SqliteBudgetLedger } from '../src/budgetLedger.js';
import { openGovernanceDatabase } from '../src/governanceDb.js';
import { createGovernanceRuntimeContext } from '../src/runtimeContext.js';

const tempDirectories: string[] = [];
const START = Date.parse('2026-08-28T12:00:00.000Z');
const childFixture = path.resolve(import.meta.dirname, 'fixtures', 'ledgerProcess.ts');

function tempDatabase(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-ledger-'));
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
  return {
    operation_id: operationId,
    fingerprint_components: {
      contract_version: M3_LEDGER_CONTRACT_VERSION,
      fingerprint_version: M3_FINGERPRINT_VERSION,
      actor: 'ai',
      tenant_id: null,
      action: 'tool.test_mutation',
      input,
      task_ref: 'task-5.1.4-test',
      is_mutating: true,
      estimate: { currency: 'usd', min: 0, max: maxUsd },
    },
    deadline_at: new Date(clock.now() + deadlineOffsetMs).toISOString(),
    audit_intent: {
      kind: GevEvents.AuditIntent,
      id: operationId,
      ts: clock.iso(),
      actor: 'ai',
      action: 'tool.test_mutation',
      target: 'test_mutation',
      params: input,
      task_ref: 'task-5.1.4-test',
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

function reserveInChild(dbPath: string, operationId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [childFixture, dbPath, operationId], {
      env: { ...process.env, NODE_ENV: 'test', VITEST: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Ledger child exited ${code}: ${stderr}`));
    });
  });
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('M3 durable budget ledger', () => {
  it('serializes two process reservations to one durable operation and one audit intent', async () => {
    const dbPath = tempDatabase();
    const operationId = crypto.randomUUID();
    const results = await Promise.all([
      reserveInChild(dbPath, operationId),
      reserveInChild(dbPath, operationId),
    ]);
    expect(results.sort()).toEqual(['in_progress', 'reserved']);

    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const operationCount = db
        .prepare('SELECT COUNT(*) AS count FROM governance_budget_operations')
        .get() as { count: number };
      const intentCount = db
        .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE kind='audit.intent'")
        .get() as { count: number };
      expect(operationCount.count).toBe(1);
      expect(intentCount.count).toBe(1);
    } finally {
      db.close();
    }
  });

  it('replays one terminal result without double settlement and conflicts on changed intent', () => {
    const clock = new FrozenClock(START);
    const runtime = createGovernanceRuntimeContext({ clock, dbPath: ':memory:', capUsd: 1 });
    const operationId = crypto.randomUUID();
    const first = runtime.budgetLedger.reserve(request(clock, operationId, 0.4));
    expect(first.kind).toBe('reserved');
    if (first.kind !== 'reserved') throw new Error('expected reservation');

    runtime.budgetLedger.startExecution(operationId, first.operation.request_fingerprint);
    const terminal = { success: true, value: 42 };
    const settled = runtime.budgetLedger.settle({
      operation_id: operationId,
      request_fingerprint: first.operation.request_fingerprint,
      actual_microusd: 250_000,
      terminal_result: terminal,
      audit_outcome: outcome(clock, operationId, terminal),
    });
    expect(settled).toMatchObject({ state: 'SETTLED', settled_microusd: 250_000 });
    expect(runtime.budgetGovernor.state().spent_usd).toBe(0.25);

    const replay = runtime.budgetLedger.reserve(request(clock, operationId, 0.4));
    expect(replay).toMatchObject({ kind: 'replay', operation: { terminal_result: terminal } });
    runtime.budgetLedger.settle({
      operation_id: operationId,
      request_fingerprint: first.operation.request_fingerprint,
      actual_microusd: 250_000,
      terminal_result: terminal,
      audit_outcome: outcome(clock, operationId, terminal),
    });
    expect(runtime.budgetGovernor.state().spent_usd).toBe(0.25);

    expect(
      runtime.budgetLedger.reserve(request(clock, operationId, 0.4, { value: 2 }))
    ).toMatchObject({
      kind: 'conflict',
    });
    runtime.close();
  });

  it('retains bind-time fingerprint components across a mid-flight runtime restart', () => {
    const dbPath = tempDatabase();
    const clock = new FrozenClock(START);
    const operationId = crypto.randomUUID();
    const originalRequest = request(clock, operationId, 0.4, { value: 7 });
    const firstRuntime = createGovernanceRuntimeContext({ clock, dbPath, capUsd: 1 });
    const reserved = firstRuntime.budgetLedger.reserve(originalRequest);
    if (reserved.kind !== 'reserved') throw new Error('expected reservation');
    expect(reserved.operation.fingerprint_components).toEqual(
      originalRequest.fingerprint_components
    );
    firstRuntime.close();

    const restarted = createGovernanceRuntimeContext({ clock, dbPath });
    const retry = restarted.budgetLedger.reserve(originalRequest);
    expect(retry).toMatchObject({
      kind: 'in_progress',
      operation: {
        contract_version: M3_LEDGER_CONTRACT_VERSION,
        fingerprint_version: M3_FINGERPRINT_VERSION,
        fingerprint_components: originalRequest.fingerprint_components,
      },
    });
    restarted.close();
  });

  it('holds ambiguous executions through restart until separate human reconciliation and resume', () => {
    const dbPath = tempDatabase();
    const clock = new FrozenClock(START);
    const firstRuntime = createGovernanceRuntimeContext({ clock, dbPath, capUsd: 1 });
    const operationId = crypto.randomUUID();
    const reserved = firstRuntime.budgetLedger.reserve(request(clock, operationId, 0.3, {}, 1_000));
    if (reserved.kind !== 'reserved') throw new Error('expected reservation');
    firstRuntime.budgetLedger.startExecution(operationId, reserved.operation.request_fingerprint);
    firstRuntime.close();

    clock.setTime(START + 2_000);
    const restarted = createGovernanceRuntimeContext({ clock, dbPath });
    expect(restarted.budgetLedger.lookup(operationId)?.state).toBe('IN_DOUBT');
    expect(restarted.budgetGovernor.state()).toMatchObject({
      stasis_active: true,
      last_trip: { code: 'COMPLIANCE_DRIFT' },
    });
    expect(() => restarted.budgetGovernor.resume('human')).toThrow(/reconciliation/);

    const reconciliationId = crypto.randomUUID();
    const reconciled = restarted.budgetLedger.reconcile(
      {
        operation_id: operationId,
        resolution: 'refunded',
        actual_usd: null,
        evidence: {
          kind: 'operator_attestation',
          reference: 'incident-42',
          summary: 'Provider logs prove no effect and no charge.',
        },
        audit_intent: {
          kind: GevEvents.AuditIntent,
          id: reconciliationId,
          ts: clock.iso(),
          actor: 'human',
          action: 'governance.budget.reconcile',
          target: operationId,
          params: { resolution: 'refunded' },
          task_ref: 'human-ledger-reconciliation',
        },
      },
      'human'
    );
    expect(reconciled).toMatchObject({
      state: 'REFUNDED',
      evidence: { reference: 'incident-42' },
    });
    expect(restarted.budgetGovernor.state().stasis_active).toBe(true);
    restarted.budgetGovernor.resume('human');
    expect(restarted.budgetGovernor.state().stasis_active).toBe(false);
    restarted.close();
  });

  it('conditionally refunds an expired RESERVED operation and never redispatches it', () => {
    const clock = new FrozenClock(START);
    const runtime = createGovernanceRuntimeContext({ clock, dbPath: ':memory:', capUsd: 1 });
    const operationId = crypto.randomUUID();
    const reserved = runtime.budgetLedger.reserve(request(clock, operationId, 0.2, {}, 1_000));
    if (reserved.kind !== 'reserved') throw new Error('expected reservation');
    clock.setTime(START + 2_000);
    expect(runtime.budgetLedger.recoverExpired()).toEqual({
      refunded_operation_ids: [operationId],
      in_doubt_operation_ids: [],
    });
    expect(runtime.budgetLedger.lookup(operationId)?.state).toBe('REFUNDED');
    expect(() =>
      runtime.budgetLedger.startExecution(operationId, reserved.operation.request_fingerprint)
    ).toThrow(/Cannot dispatch/);
    runtime.close();
  });

  it('records overruns fully with COMPLIANCE_DRIFT and gives BUDGET_BREACH precedence', () => {
    for (const [cap, expectedTrip] of [
      [1, 'COMPLIANCE_DRIFT'],
      [0.5, 'BUDGET_BREACH'],
    ] as const) {
      const clock = new FrozenClock(START);
      const runtime = createGovernanceRuntimeContext({ clock, dbPath: ':memory:', capUsd: cap });
      const operationId = crypto.randomUUID();
      const reserved = runtime.budgetLedger.reserve(request(clock, operationId, 0.4));
      if (reserved.kind !== 'reserved') throw new Error('expected reservation');
      runtime.budgetLedger.startExecution(operationId, reserved.operation.request_fingerprint);
      runtime.budgetLedger.settle({
        operation_id: operationId,
        request_fingerprint: reserved.operation.request_fingerprint,
        actual_microusd: 600_000,
        terminal_result: { success: true },
        audit_outcome: outcome(clock, operationId, { success: true }),
      });
      expect(runtime.budgetGovernor.state()).toMatchObject({
        spent_usd: 0.6,
        stasis_active: true,
        last_trip: { code: expectedTrip },
      });
      runtime.close();
    }
  });

  it('bounds canonical terminal results and enforces terminal immutability in SQLite', () => {
    const dbPath = tempDatabase();
    const clock = new FrozenClock(START);
    const runtime = createGovernanceRuntimeContext({ clock, dbPath, capUsd: 1 });
    const operationId = crypto.randomUUID();
    const reserved = runtime.budgetLedger.reserve(request(clock, operationId, 0));
    if (reserved.kind !== 'reserved') throw new Error('expected reservation');
    runtime.budgetLedger.startExecution(operationId, reserved.operation.request_fingerprint);
    const settled = runtime.budgetLedger.settle({
      operation_id: operationId,
      request_fingerprint: reserved.operation.request_fingerprint,
      actual_microusd: 0,
      terminal_result: {
        immutable_reference: 'local-object:attempted-size-bypass',
        payload: 'x'.repeat(MAX_LEDGER_RESULT_BYTES + 1),
      },
      audit_outcome: outcome(clock, operationId, { ok: true }),
    });
    expect(settled.terminal_result).toMatchObject({ code: 'OUTPUT_TOO_LARGE' });
    expect(Buffer.byteLength(JSON.stringify(settled.terminal_result), 'utf8')).toBeLessThan(
      MAX_LEDGER_RESULT_BYTES
    );
    runtime.close();

    const db = new DatabaseSync(dbPath);
    try {
      expect(() =>
        db
          .prepare("UPDATE governance_budget_operations SET state='REFUNDED' WHERE operation_id=?")
          .run(operationId)
      ).toThrow(/terminal ledger operation is immutable|invalid ledger state transition/);
    } finally {
      db.close();
    }
  });

  it('rolls back settlement and spend when the atomic audit outcome insert fails', () => {
    const dbPath = tempDatabase();
    const clock = new FrozenClock(START);
    const runtime = createGovernanceRuntimeContext({ clock, dbPath, capUsd: 1 });
    const operationId = crypto.randomUUID();
    const reserved = runtime.budgetLedger.reserve(request(clock, operationId, 0.2));
    if (reserved.kind !== 'reserved') throw new Error('expected reservation');
    runtime.budgetLedger.startExecution(operationId, reserved.operation.request_fingerprint);

    const db = new DatabaseSync(dbPath);
    db.exec(`CREATE TRIGGER reject_test_outcome BEFORE INSERT ON audit_events
      WHEN NEW.kind = 'audit.outcome' BEGIN SELECT RAISE(ABORT, 'test audit failure'); END;`);
    expect(() =>
      runtime.budgetLedger.settle({
        operation_id: operationId,
        request_fingerprint: reserved.operation.request_fingerprint,
        actual_microusd: 100_000,
        terminal_result: { success: true },
        audit_outcome: outcome(clock, operationId, { success: true }),
      })
    ).toThrow(LedgerOperationError);
    expect(runtime.budgetLedger.lookup(operationId)?.state).toBe('EXECUTING');
    expect(runtime.budgetGovernor.state().spent_usd).toBe(0);
    db.exec('DROP TRIGGER reject_test_outcome;');
    db.close();
    runtime.close();
  });

  it('PROPERTY TEST: available funds remain cap minus settled spend and active holds', () => {
    const sequence = fc.array(
      fc.record({
        maxMicrousd: fc.integer({ min: 1, max: 5_000 }),
        disposition: fc.constantFrom('held', 'settled', 'refunded'),
      }),
      { minLength: 1, maxLength: 80 }
    );

    fc.assert(
      fc.property(sequence, (operations) => {
        const clock = new FrozenClock(START);
        const runtime = createGovernanceRuntimeContext({
          clock,
          dbPath: ':memory:',
          capUsd: 1,
        });
        let expectedHeld = 0;
        let expectedSpent = 0;
        const operationIds: string[] = [];
        try {
          for (const [index, item] of operations.entries()) {
            const operationId = crypto.randomUUID();
            operationIds.push(operationId);
            const reserved = runtime.budgetLedger.reserve(
              request(clock, operationId, item.maxMicrousd / 1_000_000, { index })
            );
            if (reserved.kind !== 'reserved') throw new Error('expected reservation');
            expectedHeld += reserved.operation.reserved_microusd;

            if (item.disposition === 'settled') {
              runtime.budgetLedger.startExecution(
                operationId,
                reserved.operation.request_fingerprint
              );
              const actual = Math.floor(reserved.operation.reserved_microusd / 2);
              runtime.budgetLedger.settle({
                operation_id: operationId,
                request_fingerprint: reserved.operation.request_fingerprint,
                actual_microusd: actual,
                terminal_result: { index },
                audit_outcome: outcome(clock, operationId, { index }),
              });
              expectedHeld -= reserved.operation.reserved_microusd;
              expectedSpent += actual;
            } else if (item.disposition === 'refunded') {
              runtime.budgetLedger.refund({
                operation_id: operationId,
                request_fingerprint: reserved.operation.request_fingerprint,
                actual_microusd: 0,
                terminal_result: { cancelled: true },
                audit_outcome: outcome(clock, operationId, { cancelled: true }),
                evidence: null,
              });
              expectedHeld -= reserved.operation.reserved_microusd;
            }

            const durableHeld = operationIds.reduce((total, id) => {
              const operation = runtime.budgetLedger.lookup(id);
              return operation && ['RESERVED', 'EXECUTING', 'IN_DOUBT'].includes(operation.state)
                ? total + operation.reserved_microusd
                : total;
            }, 0);
            expect(durableHeld).toBe(expectedHeld);
            expect(Math.round(runtime.budgetGovernor.state().spent_usd * 1_000_000)).toBe(
              expectedSpent
            );
            expect(Math.max(0, 1_000_000 - expectedSpent - expectedHeld)).toBeGreaterThanOrEqual(0);
          }

          const available = 1_000_000 - expectedSpent - expectedHeld;
          expect(
            runtime.budgetLedger.reserve(request(clock, crypto.randomUUID(), available / 1_000_000))
          ).toMatchObject({ kind: 'reserved' });
          expect(
            runtime.budgetLedger.reserve(request(clock, crypto.randomUUID(), 0.000001))
          ).toMatchObject({ kind: 'denied' });
        } finally {
          runtime.close();
        }
      }),
      { numRuns: 30, seed: 5_114 }
    );
  });

  it('returns typed LEDGER_UNAVAILABLE without leaking raw SQLite lock errors', () => {
    const dbPath = tempDatabase();
    const clock = new FrozenClock(START);
    const opened = openGovernanceDatabase({ dbPath, clock });
    opened.db.exec('PRAGMA busy_timeout = 1;');
    const governor = new CapBudgetGovernor({
      db: opened.db,
      resolvedDbPath: dbPath,
      capUsd: 1,
      clock,
    });
    const ledger = new SqliteBudgetLedger({ db: opened.db, clock });
    const locker = new DatabaseSync(dbPath);
    locker.exec('BEGIN IMMEDIATE;');
    try {
      expect(() => ledger.reserve(request(clock, crypto.randomUUID(), 0.1))).toThrowError(
        expect.objectContaining({
          code: 'LEDGER_UNAVAILABLE',
          message: 'Durable budget ledger unavailable',
        })
      );
    } finally {
      locker.exec('ROLLBACK;');
      locker.close();
      ledger.close();
      governor.close();
      opened.db.close();
    }
  });
});
