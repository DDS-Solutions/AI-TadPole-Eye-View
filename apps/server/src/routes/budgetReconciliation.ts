import crypto from 'node:crypto';
import {
  type Actor,
  GevEvents,
  LedgerReconciliationInputSchema,
  LedgerReconciliationResponseSchema,
} from '@gev/contracts';
import type { SimClock } from '@gev/core';
import { LedgerOperationError, type SqliteBudgetLedger } from '@gev/governance';
import { Hono } from 'hono';

export interface BudgetReconciliationRouterOptions {
  clock: SimClock;
  budgetLedger: SqliteBudgetLedger;
}

/** Authenticated, human-only recovery for an ambiguous M3 operation. */
export function createBudgetReconciliationRouter(options: BudgetReconciliationRouterOptions): Hono {
  const router = new Hono();

  router.post('/reconcile', async (c) => {
    const identity = c.var as unknown as { opsActor: Actor; opsAuthenticated: boolean };
    if (identity.opsAuthenticated !== true || identity.opsActor !== 'human') {
      return c.json(
        {
          error: 'Ledger reconciliation requires an authenticated human operator',
          code: 'HUMAN_AUTH_REQUIRED',
        },
        403
      );
    }

    const parsed = LedgerReconciliationInputSchema.safeParse(
      await c.req.json().catch(() => undefined)
    );
    if (!parsed.success) {
      return c.json(
        { error: 'Invalid reconciliation request', code: 'INVALID_RECONCILIATION_REQUEST' },
        400
      );
    }

    const intentId = crypto.randomUUID();
    try {
      const operation = options.budgetLedger.reconcile(
        {
          ...parsed.data,
          audit_intent: {
            kind: GevEvents.AuditIntent,
            id: intentId,
            ts: options.clock.iso(),
            actor: 'human',
            action: 'governance.budget.reconcile',
            target: parsed.data.operation_id,
            params: parsed.data,
            task_ref: 'human-ledger-reconciliation',
          },
        },
        'human'
      );
      return c.json(
        LedgerReconciliationResponseSchema.parse({
          operation_id: operation.operation_id,
          state: operation.state,
          settled_microusd: operation.settled_microusd,
          terminal_at: operation.terminal_at,
        })
      );
    } catch (error) {
      if (error instanceof LedgerOperationError) {
        const unavailable = error.code === 'LEDGER_UNAVAILABLE';
        return c.json(
          {
            error: unavailable
              ? 'Durable budget ledger is unavailable'
              : 'Operation cannot be reconciled from its current durable state',
            code: error.code,
          },
          unavailable ? 503 : 409
        );
      }
      return c.json(
        { error: 'Ledger reconciliation failed closed', code: 'LEDGER_UNAVAILABLE' },
        503
      );
    }
  });

  return router;
}
