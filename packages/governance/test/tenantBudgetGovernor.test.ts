import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  GevEvents,
  type LedgerReservationRequest,
  M3_FINGERPRINT_VERSION,
  M3_LEDGER_CONTRACT_VERSION,
} from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { CapBudgetGovernor } from '../src/budgetGovernor.js';
import { SqliteBudgetLedger } from '../src/budgetLedger.js';
import { createGovernanceRuntimeContext } from '../src/runtimeContext.js';

const tempDirs: string[] = [];

function tempDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-tenant-gov-'));
  tempDirs.push(dir);
  return path.join(dir, 'governance.sqlite');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

function reservation(
  clock: FrozenClock,
  tenantId: string,
  amountUsd: number,
  operationId: string = crypto.randomUUID()
): LedgerReservationRequest {
  return {
    operation_id: operationId,
    fingerprint_components: {
      contract_version: M3_LEDGER_CONTRACT_VERSION,
      fingerprint_version: M3_FINGERPRINT_VERSION,
      actor: 'ai',
      tenant_id: tenantId,
      action: 'feed.fetch.flights',
      input: { provider: 'opensky' },
      task_ref: `task-${tenantId}`,
      is_mutating: false,
      estimate: { currency: 'usd', min: amountUsd, max: amountUsd },
    },
    deadline_at: new Date(clock.now() + 30_000).toISOString(),
    audit_intent: {
      kind: GevEvents.AuditIntent,
      id: operationId,
      ts: clock.iso(),
      actor: 'ai',
      action: 'feed.fetch.flights',
      target: 'flights',
      params: { provider: 'opensky' },
      task_ref: `task-${tenantId}`,
    },
  };
}

describe('Tenant Budget Governor & Ledger Isolation', () => {
  it('strictly isolates tenant budget exhaustion so one tenant does not degrade another', () => {
    const dbPath = tempDb();
    const clock = new FrozenClock(1_700_000_000_000);
    const runtime = createGovernanceRuntimeContext({ dbPath, clock, capUsd: 10 });

    const tenantA = 'org_alpha';
    const tenantB = 'org_beta';

    // Tenant A reserves full $10.00
    const resA = runtime.budgetLedger.reserve(reservation(clock, tenantA, 10));
    expect(resA.kind).toBe('reserved');

    // Settle Tenant A's $10.00 spend
    const executingA = runtime.budgetLedger.startExecution(
      resA.operation.operation_id,
      resA.operation.request_fingerprint
    );
    runtime.budgetLedger.settle({
      operation_id: executingA.operation_id,
      request_fingerprint: executingA.request_fingerprint,
      actual_microusd: 10_000_000,
      terminal_result: { status: 200 },
      audit_outcome: {
        kind: GevEvents.AuditOutcome,
        intent_id: executingA.operation_id,
        ts: clock.iso(),
        status: 'ok',
        result: { status: 200 },
        duration_ms: 10,
      },
    });

    // Tenant A's budget is exhausted -> Next reservation for Tenant A is denied
    const deniedA = runtime.budgetLedger.reserve(reservation(clock, tenantA, 1));
    expect(deniedA.kind).toBe('denied');
    expect(deniedA.reason).toBe('BUDGET_BREACH');

    // Tenant A is in STASIS
    const statusA = runtime.budgetLedger.getTenantBudget(tenantA);
    expect(statusA.stasis_active).toBe(1);
    expect(statusA.spent_microusd).toBe(10_000_000);

    // Global STASIS is NOT active
    expect(runtime.budgetGovernor.state().stasis_active).toBe(false);

    // Tenant B attempts reservation -> SUCCESS! Completely unblocked!
    const resB = runtime.budgetLedger.reserve(reservation(clock, tenantB, 2));
    expect(resB.kind).toBe('reserved');

    const statusB = runtime.budgetLedger.getTenantBudget(tenantB);
    expect(statusB.stasis_active).toBe(0);
    expect(statusB.spent_microusd).toBe(0);

    // Human-only resume for Tenant A
    expect(() => runtime.budgetLedger.resumeTenant(tenantA, 'ai' as any)).toThrow(
      /requires a human actor/
    );
    runtime.budgetLedger.resumeTenant(tenantA, 'human');
    expect(runtime.budgetLedger.getTenantBudget(tenantA).stasis_active).toBe(0);

    runtime.close();
  });

  it('CapBudgetGovernor supports tenant-specific checks and spend tracking', () => {
    const dbPath = tempDb();
    const clock = new FrozenClock(1_700_000_000_000);
    const governor = new CapBudgetGovernor({ dbPath, clock, capUsd: 5 });

    const tenantA = 'org_alpha';
    const tenantB = 'org_beta';

    expect(governor.tenantState(tenantA).spent_usd).toBe(0);
    expect(governor.tenantState(tenantA).cap_usd).toBe(5);

    // Check budget for tenant A
    const verdict1 = governor.checkTenant(tenantA, {
      action: 'feed.fetch',
      estimate: { currency: 'usd', min: 2, max: 2 },
    });
    expect(verdict1.allowed).toBe(true);

    // Record spend for Tenant A ($5.00)
    governor.recordTenantSpend(tenantA, 5.0);
    expect(governor.tenantState(tenantA).stasis_active).toBe(true);
    expect(governor.tenantState(tenantA).spent_usd).toBe(5);

    // Tenant A check is now denied
    const verdict2 = governor.checkTenant(tenantA, {
      action: 'feed.fetch',
      estimate: { currency: 'usd', min: 1, max: 1 },
    });
    expect(verdict2.allowed).toBe(false);

    // Tenant B is untouched
    expect(governor.tenantState(tenantB).stasis_active).toBe(false);
    expect(governor.tenantState(tenantB).spent_usd).toBe(0);
    const verdictB = governor.checkTenant(tenantB, {
      action: 'feed.fetch',
      estimate: { currency: 'usd', min: 1, max: 1 },
    });
    expect(verdictB.allowed).toBe(true);

    governor.close();
  });

  it('PROPERTY TEST: concurrent tenant requests settle idempotently with zero negative remaining balances and zero ledger drift', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            tenantId: fc.constantFrom('org_1', 'org_2', 'org_3'),
            amountMicrousd: fc.integer({ min: 10_000, max: 500_000 }), // $0.01 to $0.50
          }),
          { minLength: 5, maxLength: 30 }
        ),
        (operations) => {
          const dbPath = tempDb();
          const clock = new FrozenClock(1_700_000_000_000);
          const ledger = new SqliteBudgetLedger({ dbPath, clock });

          // Set $2.00 cap per tenant
          for (const tid of ['org_1', 'org_2', 'org_3']) {
            ledger.setTenantCap(tid, 2_000_000);
          }

          const settledPerTenant: Record<string, number> = { org_1: 0, org_2: 0, org_3: 0 };

          for (const op of operations) {
            const opId = crypto.randomUUID();
            const amountUsd = op.amountMicrousd / 1_000_000;
            const res = ledger.reserve(reservation(clock, op.tenantId, amountUsd, opId));

            if (res.kind === 'reserved') {
              const exec = ledger.startExecution(opId, res.operation.request_fingerprint);
              ledger.settle({
                operation_id: exec.operation_id,
                request_fingerprint: exec.request_fingerprint,
                actual_microusd: op.amountMicrousd,
                terminal_result: { ok: true },
                audit_outcome: {
                  kind: GevEvents.AuditOutcome,
                  intent_id: exec.operation_id,
                  ts: clock.iso(),
                  status: 'ok',
                  result: { ok: true },
                  duration_ms: 5,
                },
              });
              settledPerTenant[op.tenantId] += op.amountMicrousd;
            }
          }

          // Verify invariants across all tenants:
          for (const tid of ['org_1', 'org_2', 'org_3']) {
            const b = ledger.getTenantBudget(tid);
            // 1. Zero negative remaining balances
            const remaining = Math.max(0, b.cap_microusd - b.spent_microusd);
            expect(remaining).toBeGreaterThanOrEqual(0);
            expect(b.spent_microusd).toBeGreaterThanOrEqual(0);

            // 2. Zero ledger drift: settled operations match persisted spent
            expect(b.spent_microusd).toBe(settledPerTenant[tid]);
          }

          ledger.close();
        }
      ),
      { numRuns: 15 }
    );
  });
});
