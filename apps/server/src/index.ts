import crypto from 'node:crypto';
import {
  type Actor,
  type BoundingBox,
  BoundingBox as BoundingBoxSchema,
  GevEvents,
} from '@gev/contracts';
import { SystemClock } from '@gev/core';
import { CapBudgetGovernor, PromptApprovalGate, SqliteAuditSink } from '@gev/governance';
import { OpenSkyAdapter } from '@gev/providers';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

export function createApp() {
  const app = new Hono();
  const clock = new SystemClock();
  const openSkyAdapter = new OpenSkyAdapter({ clock });
  const auditSink = new SqliteAuditSink({ clock });
  const budgetGovernor = new CapBudgetGovernor({ clock });
  const approvalGate = new PromptApprovalGate({ clock });

  // Middleware
  app.use('*', cors());

  // Health and provider status
  app.get('/api/health', async (c) => {
    const govState = budgetGovernor.state();
    return c.json({
      status: 'ok',
      version: '0.1.0',
      seed_mode: true,
      timestamp: clock.now(),
      stasis_active: govState.stasis_active,
      budget_remaining_usd: Math.max(0, govState.cap_usd - govState.spent_usd),
    });
  });

  // Flight telemetry feed proxy
  app.get('/api/flights', async (c) => {
    let bbox: BoundingBox | undefined;
    const lamin = c.req.query('lamin');
    const lamax = c.req.query('lamax');
    const lomin = c.req.query('lomin');
    const lomax = c.req.query('lomax');

    if (lamin && lamax && lomin && lomax) {
      const parsed = BoundingBoxSchema.safeParse({
        min_lat: Number.parseFloat(lamin),
        max_lat: Number.parseFloat(lamax),
        min_lon: Number.parseFloat(lomin),
        max_lon: Number.parseFloat(lomax),
      });

      if (parsed.success) {
        bbox = parsed.data;
      }
    }

    try {
      const batch = await openSkyAdapter.getFlights(bbox);
      return c.json(batch);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown provider error';
      return c.json({ error: message, source: 'opensky' }, 502);
    }
  });

  // Governed Mutating Endpoint (Rule 1, Rule 2 & PLAN.md §6):
  // Strict order: intent → budget.check → approval → execute → outcome
  app.post('/ops/seed/reload', async (c) => {
    const startTime = clock.now();
    const taskRef = c.req.header('X-Task-Ref') || `task-${crypto.randomUUID().slice(0, 8)}`;
    const actorHeader = c.req.header('X-Actor') as Actor | undefined;
    const actor: Actor = actorHeader === 'human' || actorHeader === 'system' ? actorHeader : 'ai';
    const intentId = crypto.randomUUID();
    const intentTs = new Date(startTime).toISOString();

    // 1. Audit Intent FIRST (Rule 1)
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

    // 2. Budget Governor Check (Rule 2)
    const spendVerdict = budgetGovernor.check({
      action: 'seed.reload',
      estimate: { currency: 'usd', min: 0.05, max: 0.05 },
    });

    if (!spendVerdict.allowed) {
      const durationMs = clock.now() - startTime;
      auditSink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: new Date(clock.now()).toISOString(),
        status: 'blocked',
        error: spendVerdict.message,
        duration_ms: durationMs,
      });

      return c.json(
        {
          status: 'blocked',
          intent_id: intentId,
          reason: spendVerdict.reason,
          message: spendVerdict.message,
          stasis_active: true,
        },
        429
      );
    }

    // 3. Approval Gate Check
    const approvalDecision = await approvalGate.request({
      id: crypto.randomUUID(),
      ts: new Date(clock.now()).toISOString(),
      intent_id: intentId,
      scopes: ['repo.write'],
      rationale: 'Reload deterministic flight seed fixtures',
      expires_at: new Date(clock.now() + 30000).toISOString(),
    });

    if (approvalDecision.decision !== 'approved') {
      const durationMs = clock.now() - startTime;
      auditSink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: new Date(clock.now()).toISOString(),
        status: 'blocked',
        error: `Approval denied by ${approvalDecision.decided_by}`,
        duration_ms: durationMs,
      });

      return c.json(
        {
          status: 'denied',
          intent_id: intentId,
          decision: approvalDecision.decision,
        },
        403
      );
    }

    // 4. Deterministic Execution
    try {
      const batch = await openSkyAdapter.getFlights();
      const durationMs = clock.now() - startTime;

      // 5. Audit Outcome AFTER (Rule 1)
      auditSink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: new Date(clock.now()).toISOString(),
        status: 'ok',
        result: {
          reloaded: true,
          aircraft_count: batch.states.length,
          time: batch.time,
        },
        duration_ms: durationMs,
      });

      return c.json({
        status: 'ok',
        intent_id: intentId,
        result: {
          reloaded: true,
          aircraft_count: batch.states.length,
        },
      });
    } catch (err: unknown) {
      const durationMs = clock.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : 'Unknown reload failure';

      auditSink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: new Date(clock.now()).toISOString(),
        status: 'error',
        error: errorMsg,
        duration_ms: durationMs,
      });

      return c.json({ status: 'error', intent_id: intentId, error: errorMsg }, 500);
    }
  });

  // Ops Audit Log Query
  app.get('/ops/audit', async (c) => {
    const taskRef = c.req.query('task_ref');
    if (taskRef) {
      const entries = auditSink.tailByTaskRef(taskRef);
      return c.json({ entries });
    }
    const entries = auditSink.tail();
    return c.json({ entries });
  });

  // Ops Governor Status
  app.get('/ops/status', async (c) => {
    return c.json(budgetGovernor.state());
  });

  return { app, auditSink, budgetGovernor, approvalGate, clock };
}

const { app } = createApp();

const port = 3000;
console.log(`[GEV v2 Server] Hono server listening on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
