import crypto from 'node:crypto';
import {
  type Actor,
  type ApprovalGate,
  type ApprovalResult,
  type AuditSink,
  type BudgetGovernor,
  GevEvents,
} from '@gev/contracts';
import type { SimClock } from '@gev/core';
import type { OpenSkyAdapter } from '@gev/providers';
import { Hono } from 'hono';

export interface SeedReloadRouterOptions {
  clock: SimClock;
  auditSink: AuditSink;
  budgetGovernor: BudgetGovernor;
  approvalGate: ApprovalGate;
  openSkyAdapter: OpenSkyAdapter;
}

/** Governed seed reload: intent → budget → approval → action → outcome. */
export function createSeedReloadRouter(options: SeedReloadRouterOptions): Hono {
  const app = new Hono();
  const { clock, auditSink, budgetGovernor, approvalGate, openSkyAdapter } = options;

  app.post('/reload', async (context) => {
    const startTime = clock.now();
    const taskRef = context.req.header('X-Task-Ref') || `task-${crypto.randomUUID().slice(0, 8)}`;
    const actor = (context.var as unknown as { opsActor: Actor }).opsActor;
    const intentId = crypto.randomUUID();
    const intentTs = clock.iso();

    auditSink.intent({
      kind: GevEvents.AuditIntent,
      id: intentId,
      ts: intentTs,
      actor,
      action: 'seed.reload',
      target: 'fixtures/flights-opensky.json',
      params: { timestamp: startTime },
      task_ref: taskRef,
    });

    const spendVerdict = budgetGovernor.check({
      action: 'seed.reload',
      estimate: { currency: 'usd', min: 0.05, max: 0.05 },
    });
    if (!spendVerdict.allowed) {
      auditSink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: clock.iso(),
        status: 'blocked',
        error: `STASIS active or budget exceeded: ${spendVerdict.message} (${spendVerdict.reason})`,
        duration_ms: clock.now() - startTime,
      });
      return context.json(
        {
          status: 'blocked',
          intent_id: intentId,
          stasis_active: budgetGovernor.state().stasis_active,
          reason: spendVerdict.reason,
          message: spendVerdict.message,
        },
        429
      );
    }

    let approvalDecision: ApprovalResult;
    try {
      approvalDecision = await approvalGate.request({
        id: crypto.randomUUID(),
        ts: intentTs,
        intent_id: intentId,
        scopes: ['flags.write'],
        nonce: crypto.randomUUID(),
        rationale: 'Reloading seed fixtures mutates in-memory telemetry state for active session',
        expires_at: new Date(startTime + 30_000).toISOString(),
      });
    } catch {
      auditSink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: clock.iso(),
        status: 'error',
        error: 'Approval gate unavailable or signed decision verification failed',
        duration_ms: clock.now() - startTime,
      });
      return context.json(
        { status: 'error', intent_id: intentId, code: 'APPROVAL_UNAVAILABLE' },
        503
      );
    }

    if (approvalDecision.decision !== 'approved') {
      auditSink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: clock.iso(),
        status: 'blocked',
        error: `Action denied by approval gate (decision: ${approvalDecision.decision})`,
        duration_ms: clock.now() - startTime,
      });
      return context.json(
        { status: 'denied', intent_id: intentId, decision: approvalDecision.decision },
        403
      );
    }

    try {
      const batch = await openSkyAdapter.getFlights();
      auditSink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: clock.iso(),
        status: 'ok',
        result: {
          reloaded: true,
          aircraft_count: batch.states.length,
          time: batch.time,
        },
        duration_ms: clock.now() - startTime,
      });
      return context.json({
        status: 'ok',
        intent_id: intentId,
        result: { reloaded: true, aircraft_count: batch.states.length },
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown reload failure';
      auditSink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: clock.iso(),
        status: 'error',
        error: errorMessage,
        duration_ms: clock.now() - startTime,
      });
      return context.json({ status: 'error', intent_id: intentId, error: errorMessage }, 500);
    }
  });

  return app;
}
