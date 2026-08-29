import crypto from 'node:crypto';
import {
  type Actor,
  type ApprovalGate,
  type ApprovalResult,
  GevEvents,
  type LedgerOperation,
  type LedgerReservationResult,
  M3_FINGERPRINT_VERSION,
  M3_LEDGER_CONTRACT_VERSION,
} from '@gev/contracts';
import type { SimClock } from '@gev/core';
import type { SqliteBudgetLedger } from '@gev/governance';
import type { OpenSkyAdapter } from '@gev/providers';
import { type Context, Hono } from 'hono';

export interface SeedReloadRouterOptions {
  clock: SimClock;
  budgetLedger: SqliteBudgetLedger;
  approvalGate: ApprovalGate;
  openSkyAdapter: OpenSkyAdapter;
}

/** M3-governed seed reload: atomic reserve+intent -> approval -> action -> settle+outcome. */
export function createSeedReloadRouter(options: SeedReloadRouterOptions): Hono {
  const app = new Hono();
  const { clock, budgetLedger, approvalGate, openSkyAdapter } = options;

  app.post('/reload', async (context) => {
    const startTime = clock.now();
    const actor = (context.var as unknown as { opsActor: Actor }).opsActor;
    const operationId = context.req.header('Idempotency-Key') ?? crypto.randomUUID();
    const taskRef = context.req.header('X-Task-Ref') || `seed-reload:${operationId}`;
    context.header('X-GEV-Operation-Id', operationId);
    let reservation: LedgerReservationResult;
    try {
      reservation = budgetLedger.reserve({
        operation_id: operationId,
        fingerprint_components: {
          contract_version: M3_LEDGER_CONTRACT_VERSION,
          fingerprint_version: M3_FINGERPRINT_VERSION,
          actor,
          tenant_id: null,
          action: 'seed.reload',
          input: {},
          task_ref: taskRef,
          is_mutating: true,
          estimate: { currency: 'usd', min: 0.05, max: 0.05 },
        },
        deadline_at: new Date(startTime + 30_000).toISOString(),
        audit_intent: {
          kind: GevEvents.AuditIntent,
          id: operationId,
          ts: clock.iso(),
          actor,
          action: 'seed.reload',
          target: 'fixtures/flights-opensky.json',
          params: {},
          task_ref: taskRef,
        },
      });
    } catch {
      return context.json({ status: 'error', code: 'LEDGER_UNAVAILABLE' }, 503);
    }

    if (reservation.kind === 'replay') return replayResponse(context, reservation.operation);
    if (reservation.kind === 'denied') {
      return context.json(
        {
          status: 'blocked',
          intent_id: operationId,
          stasis_active: true,
          reason: reservation.reason,
          message: reservation.message,
        },
        429
      );
    }
    if (reservation.kind === 'conflict') {
      return context.json({ status: 'error', code: 'IDEMPOTENCY_CONFLICT' }, 409);
    }
    if (reservation.kind === 'in_progress') {
      return context.json({ status: 'error', code: 'OPERATION_IN_PROGRESS' }, 409);
    }
    if (reservation.kind === 'in_doubt') {
      return context.json({ status: 'error', code: 'OPERATION_IN_DOUBT' }, 409);
    }

    const fingerprint = reservation.operation.request_fingerprint;
    let approvalDecision: ApprovalResult;
    try {
      approvalDecision = await approvalGate.request({
        id: crypto.randomUUID(),
        ts: clock.iso(),
        intent_id: operationId,
        scopes: ['flags.write'],
        nonce: crypto.randomUUID(),
        rationale: 'Reloading seed fixtures mutates in-memory telemetry state for active session',
        expires_at: new Date(startTime + 30_000).toISOString(),
      });
    } catch {
      return refundBeforeDispatch(
        context,
        options,
        operationId,
        fingerprint,
        startTime,
        { status: 'error', intent_id: operationId, code: 'APPROVAL_UNAVAILABLE' },
        503
      );
    }

    if (approvalDecision.decision !== 'approved') {
      return refundBeforeDispatch(
        context,
        options,
        operationId,
        fingerprint,
        startTime,
        { status: 'denied', intent_id: operationId, decision: approvalDecision.decision },
        403
      );
    }

    try {
      budgetLedger.startExecution(operationId, fingerprint);
    } catch {
      return refundBeforeDispatch(
        context,
        options,
        operationId,
        fingerprint,
        startTime,
        { status: 'error', intent_id: operationId, code: 'RESERVATION_EXPIRED' },
        409
      );
    }

    try {
      const batch = await openSkyAdapter.getFlights();
      const terminal = {
        status: 'ok',
        intent_id: operationId,
        result: { reloaded: true, aircraft_count: batch.states.length },
      };
      const settled = budgetLedger.settle({
        operation_id: operationId,
        request_fingerprint: fingerprint,
        actual_microusd: 50_000,
        terminal_result: terminal,
        audit_outcome: {
          kind: GevEvents.AuditOutcome,
          intent_id: operationId,
          ts: clock.iso(),
          status: 'ok',
          result: terminal,
          duration_ms: clock.now() - startTime,
        },
      });
      return replayResponse(context, settled);
    } catch (error) {
      const terminal = {
        status: 'error',
        intent_id: operationId,
        code: 'OPERATION_IN_DOUBT',
      };
      try {
        budgetLedger.markInDoubt({
          operation_id: operationId,
          request_fingerprint: fingerprint,
          reason: error instanceof Error ? error.message : String(error),
          audit_outcome: {
            kind: GevEvents.AuditOutcome,
            intent_id: operationId,
            ts: clock.iso(),
            status: 'error',
            result: terminal,
            error: 'Seed reload outcome is ambiguous',
            duration_ms: clock.now() - startTime,
          },
        });
      } catch {
        // The route remains fail closed when ambiguity cannot be persisted.
      }
      return context.json(terminal, 503);
    }
  });

  return app;
}

function refundBeforeDispatch(
  context: Context,
  options: SeedReloadRouterOptions,
  operationId: string,
  fingerprint: string,
  startTime: number,
  terminal: Record<string, unknown>,
  statusCode: 403 | 409 | 503
): Response {
  try {
    const refunded = options.budgetLedger.refund({
      operation_id: operationId,
      request_fingerprint: fingerprint,
      actual_microusd: 0,
      terminal_result: terminal,
      audit_outcome: {
        kind: GevEvents.AuditOutcome,
        intent_id: operationId,
        ts: options.clock.iso(),
        status: statusCode === 403 ? 'blocked' : 'error',
        result: terminal,
        ...(statusCode === 403 ? { error: 'Approval denied' } : {}),
        duration_ms: options.clock.now() - startTime,
      },
      evidence: null,
    });
    return replayResponse(context, refunded, statusCode);
  } catch {
    return context.json({ status: 'error', code: 'LEDGER_UNAVAILABLE' }, 503);
  }
}

function replayResponse(
  context: Context,
  operation: LedgerOperation,
  statusCode: 200 | 403 | 409 | 503 = 200
): Response {
  if (!operation.terminal_result || typeof operation.terminal_result !== 'object') {
    return context.json({ status: 'error', code: 'LEDGER_UNAVAILABLE' }, 503);
  }
  return context.json(operation.terminal_result, statusCode);
}
