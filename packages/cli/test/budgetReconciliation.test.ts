import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GevEvents, M3_FINGERPRINT_VERSION, M3_LEDGER_CONTRACT_VERSION } from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { createGovernanceRuntimeContext } from '@gev/governance';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runBudgetReconcile } from '../src/commands/budget.js';

const tempDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('gev budget reconcile', () => {
  it('uses the durable local ledger when loopback is offline and leaves resume separate', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-cli-ledger-'));
    tempDirectories.push(directory);
    const dbPath = path.join(directory, 'governance.sqlite');
    const clock = new FrozenClock(Date.parse('2026-08-28T12:00:00.000Z'));
    const runtime = createGovernanceRuntimeContext({ clock, dbPath, capUsd: 1 });
    const operationId = crypto.randomUUID();
    const reservation = runtime.budgetLedger.reserve({
      operation_id: operationId,
      fingerprint_components: {
        contract_version: M3_LEDGER_CONTRACT_VERSION,
        fingerprint_version: M3_FINGERPRINT_VERSION,
        actor: 'system',
        tenant_id: null,
        action: 'tool.cli_reconciliation_test',
        input: {},
        task_ref: 'cli-reconciliation-test',
        is_mutating: true,
        estimate: { currency: 'usd', min: 0, max: 0.1 },
      },
      deadline_at: new Date(clock.now() + 30_000).toISOString(),
      audit_intent: {
        kind: GevEvents.AuditIntent,
        id: operationId,
        ts: clock.iso(),
        actor: 'system',
        action: 'tool.cli_reconciliation_test',
        target: 'cli_reconciliation_test',
        params: {},
        task_ref: 'cli-reconciliation-test',
      },
    });
    if (reservation.kind !== 'reserved') throw new Error('expected reservation');
    runtime.budgetLedger.startExecution(operationId, reservation.operation.request_fingerprint);
    runtime.budgetLedger.markInDoubt({
      operation_id: operationId,
      request_fingerprint: reservation.operation.request_fingerprint,
      reason: 'simulated ambiguous result',
      audit_outcome: {
        kind: GevEvents.AuditOutcome,
        intent_id: operationId,
        ts: clock.iso(),
        status: 'error',
        error: 'simulated ambiguous result',
      },
    });
    runtime.close();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('server offline')));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await runBudgetReconcile(operationId, {
      refunded: true,
      summary: 'Local logs prove no effect and no charge.',
      evidenceKind: 'local_log',
      reference: 'log-42',
      governanceDbPath: dbPath,
    });

    const observer = createGovernanceRuntimeContext({ dbPath });
    try {
      expect(observer.budgetLedger.lookup(operationId)).toMatchObject({
        state: 'REFUNDED',
        settled_microusd: 0,
        evidence: { kind: 'local_log', reference: 'log-42' },
      });
      expect(observer.budgetGovernor.state().stasis_active).toBe(true);
    } finally {
      observer.close();
    }
  });

  it('requires exactly one settlement or refund resolution', async () => {
    await expect(
      runBudgetReconcile(crypto.randomUUID(), {
        summary: 'Missing resolution must fail before any connection attempt.',
      })
    ).rejects.toThrow(/exactly one/);
  });
});
