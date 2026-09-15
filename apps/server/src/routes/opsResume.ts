import crypto from 'node:crypto';
import { type Actor, type AuthenticatedIdentityContext, GevEvents } from '@gev/contracts';
import type { SimClock } from '@gev/core';
import type { CapBudgetGovernor, SqliteAuditSink } from '@gev/governance';
import { Hono } from 'hono';

export interface OpsResumeRouterOptions {
  clock: SimClock;
  auditSink: SqliteAuditSink;
  budgetGovernor: CapBudgetGovernor;
}

export function createOpsResumeRouter(options: OpsResumeRouterOptions): Hono {
  const router = new Hono();
  const { clock, auditSink, budgetGovernor } = options;

  router.get('/status', async (c) => {
    return c.json(budgetGovernor.state());
  });

  // Ops STASIS Resume (Rule 1: intent → action → outcome; human-only)
  router.post('/resume', async (c) => {
    const identity = c.var as unknown as {
      opsActor: Actor;
      opsAuthenticated: boolean;
      opsIdentity?: AuthenticatedIdentityContext;
    };
    const actor = identity.opsActor;
    if (
      identity.opsAuthenticated !== true ||
      actor !== 'human' ||
      identity.opsIdentity?.role !== 'platform_admin'
    ) {
      return c.json(
        {
          error: 'STASIS resume requires an authenticated human operator',
          code: 'HUMAN_AUTH_REQUIRED',
        },
        403
      );
    }
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
    const reason = body.reason ?? 'Human operator manual override via ops API';
    const state = budgetGovernor.state();

    if (!state.stasis_active) {
      return c.json({ status: 'ok', message: 'STASIS is not currently active' });
    }

    const startTime = clock.now();
    const intentId = crypto.randomUUID();

    // Rule 1: Audit intent BEFORE mutation
    auditSink.intent({
      kind: GevEvents.AuditIntent,
      id: intentId,
      ts: new Date(startTime).toISOString(),
      actor,
      action: 'governance.resume',
      target: 'stasis.lock',
      params: { reason },
      task_ref: 'ops-resume',
    });

    try {
      budgetGovernor.resume(actor);
    } catch (error) {
      const reconciliationRequired =
        error instanceof Error && error.message.includes('reconciliation');
      auditSink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: new Date(clock.now()).toISOString(),
        status: 'blocked',
        error: reconciliationRequired
          ? 'Human reconciliation is required before STASIS resume'
          : 'STASIS resume failed closed',
        duration_ms: clock.now() - startTime,
      });
      return c.json(
        {
          error: reconciliationRequired
            ? 'Reconcile every ambiguous operation before resuming STASIS'
            : 'STASIS resume failed closed',
          code: reconciliationRequired ? 'RECONCILIATION_REQUIRED' : 'GOVERNANCE_UNAVAILABLE',
        },
        reconciliationRequired ? 409 : 503
      );
    }

    // Rule 1: Audit outcome AFTER mutation
    auditSink.outcome({
      kind: GevEvents.AuditOutcome,
      intent_id: intentId,
      ts: new Date(clock.now()).toISOString(),
      status: 'ok',
      result: { resumed: true, reason },
      duration_ms: clock.now() - startTime,
    });

    return c.json({ status: 'ok', message: 'STASIS resumed', reason });
  });

  return router;
}
