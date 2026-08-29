import crypto from 'node:crypto';
import { GevEvents, M3_FINGERPRINT_VERSION, M3_LEDGER_CONTRACT_VERSION } from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/index.js';

const OPS_TOKEN = 'm3-reconciliation-test-token';

describe('human M3 reconciliation route', () => {
  it('refuses resume until an authenticated human reconciles the ambiguous operation', async () => {
    const clock = new FrozenClock(Date.parse('2026-08-28T12:00:00.000Z'));
    const context = createApp({
      clock,
      opsAuth: { opsToken: OPS_TOKEN, requireAuth: true },
    });
    try {
      const operationId = crypto.randomUUID();
      const reservation = context.budgetLedger.reserve({
        operation_id: operationId,
        fingerprint_components: {
          contract_version: M3_LEDGER_CONTRACT_VERSION,
          fingerprint_version: M3_FINGERPRINT_VERSION,
          actor: 'system',
          tenant_id: null,
          action: 'tool.server_reconciliation_test',
          input: {},
          task_ref: 'server-reconciliation-test',
          is_mutating: true,
          estimate: { currency: 'usd', min: 0, max: 0.1 },
        },
        deadline_at: new Date(clock.now() + 30_000).toISOString(),
        audit_intent: {
          kind: GevEvents.AuditIntent,
          id: operationId,
          ts: clock.iso(),
          actor: 'system',
          action: 'tool.server_reconciliation_test',
          target: 'server_reconciliation_test',
          params: {},
          task_ref: 'server-reconciliation-test',
        },
      });
      if (reservation.kind !== 'reserved') throw new Error('expected reservation');
      context.budgetLedger.startExecution(operationId, reservation.operation.request_fingerprint);
      context.budgetLedger.markInDoubt({
        operation_id: operationId,
        request_fingerprint: reservation.operation.request_fingerprint,
        reason: 'simulated lost acknowledgement',
        audit_outcome: {
          kind: GevEvents.AuditOutcome,
          intent_id: operationId,
          ts: clock.iso(),
          status: 'error',
          error: 'simulated lost acknowledgement',
        },
      });

      const blockedResume = await context.app.request('/ops/resume', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'must not resume yet' }),
      });
      expect(blockedResume.status).toBe(409);
      await expect(blockedResume.json()).resolves.toMatchObject({
        code: 'RECONCILIATION_REQUIRED',
      });

      const response = await context.app.request('/ops/budget/reconcile', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation_id: operationId,
          resolution: 'refunded',
          actual_usd: null,
          evidence: {
            kind: 'provider_receipt',
            reference: 'receipt-42',
            summary: 'Provider receipt confirms no effect and no charge.',
          },
        }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        operation_id: operationId,
        state: 'REFUNDED',
        settled_microusd: 0,
      });
      expect(context.budgetLedger.lookup(operationId)).toMatchObject({
        state: 'REFUNDED',
        evidence: { reference: 'receipt-42' },
      });
      expect(context.budgetGovernor.state().stasis_active).toBe(true);

      const resumed = await context.app.request('/ops/resume', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'reconciliation complete' }),
      });
      expect(resumed.status).toBe(200);
      expect(context.budgetGovernor.state().stasis_active).toBe(false);
    } finally {
      context.governanceContext.close();
    }
  });

  it('does not treat tokenless local seed access as human reconciliation', async () => {
    const context = createApp({ opsAuth: { opsToken: '', requireAuth: false } });
    try {
      const response = await context.app.request('/ops/budget/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ code: 'HUMAN_AUTH_REQUIRED' });
    } finally {
      context.governanceContext.close();
    }
  });
});
