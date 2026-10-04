import { GevEvents, type LedgerOperation, MAX_LEDGER_RESULT_BYTES } from '@gev/contracts';
import type { SimClock } from '@gev/core';
import type { SqliteBudgetLedger } from '@gev/governance';
import { markResponseProvenanceCached } from '@gev/providers';
import type { Context } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';
import {
  feedFailureResult,
  isFeedTerminal,
  readFeedTerminalResponse,
} from './billableFeedResult.js';

export interface ActiveReservation {
  operationId: string;
  requestFingerprint: string;
  startedAt: number;
  actualMicrousd: number;
}

export function refundExpiredReservation(
  ledger: SqliteBudgetLedger | undefined,
  clock: SimClock,
  operation: LedgerOperation,
  providerName: string
): void {
  const terminal = feedFailureResult(
    operation.operation_id,
    'RESERVATION_EXPIRED',
    'Reservation expired before dispatch'
  );
  ledger?.refund({
    operation_id: operation.operation_id,
    request_fingerprint: operation.request_fingerprint,
    actual_microusd: 0,
    terminal_result: terminal,
    audit_outcome: {
      kind: GevEvents.AuditOutcome,
      intent_id: operation.operation_id,
      ts: clock.iso(),
      status: 'blocked',
      result: terminal,
      error: `Reservation expired before ${providerName} dispatch`,
      duration_ms: 0,
    },
    evidence: null,
  });
}

export function markAmbiguousReservation(
  ledger: SqliteBudgetLedger | undefined,
  clock: SimClock,
  reservation: ActiveReservation,
  providerName: string,
  error: unknown
): void {
  const message = error instanceof Error ? error.message : String(error);
  const terminal = feedFailureResult(
    reservation.operationId,
    'OPERATION_IN_DOUBT',
    `${providerName} outcome is ambiguous`
  );
  try {
    ledger?.markInDoubt({
      operation_id: reservation.operationId,
      request_fingerprint: reservation.requestFingerprint,
      reason: message,
      audit_outcome: {
        kind: GevEvents.AuditOutcome,
        intent_id: reservation.operationId,
        ts: clock.iso(),
        status: 'error',
        result: terminal,
        error: terminal.error,
        duration_ms: Math.max(0, clock.now() - reservation.startedAt),
      },
    });
  } catch (markError) {
    console.error(
      `[CostGovernor] Failed to mark ambiguous reservation in ledger: operation=${reservation.operationId}`,
      markError
    );
  }
}

export async function settleBillableReservation(
  c: Context,
  ledger: SqliteBudgetLedger | undefined,
  clock: SimClock,
  reservation: ActiveReservation,
  providerName: string,
  options?: { fallbackServed?: boolean; upstreamStatus?: number }
): Promise<Response | null> {
  const terminal = await readFeedTerminalResponse(c.res);
  if (!ledger) {
    return c.json(
      { error: 'Durable budget ledger is unavailable', code: 'LEDGER_UNAVAILABLE' },
      503
    );
  }

  // G-07 & D-05: Validate bounds BEFORE settling money
  const isOversized =
    terminal.status === 413 &&
    typeof terminal.body === 'object' &&
    terminal.body !== null &&
    (terminal.body as { code?: string }).code === 'OUTPUT_TOO_LARGE';
  const terminalBytes = Buffer.byteLength(JSON.stringify(terminal), 'utf8');
  if (isOversized || terminalBytes > MAX_LEDGER_RESULT_BYTES) {
    try {
      ledger.refund({
        operation_id: reservation.operationId,
        request_fingerprint: reservation.requestFingerprint,
        actual_microusd: 0,
        terminal_result: terminal,
        evidence: {
          kind: 'local_log',
          reference: `output-bounds-${reservation.operationId.slice(0, 16)}`,
          summary: `Provider response (${isOversized ? '> ' + MAX_LEDGER_RESULT_BYTES : terminalBytes} bytes) exceeded durable replay bounds (${MAX_LEDGER_RESULT_BYTES} bytes)`,
        },
        audit_outcome: {
          kind: GevEvents.AuditOutcome,
          intent_id: reservation.operationId,
          ts: clock.iso(),
          status: 'error',
          result: terminal,
          error: 'Provider response exceeded durable replay bounds',
          duration_ms: Math.max(0, clock.now() - reservation.startedAt),
        },
      });
    } catch (refundError) {
      markAmbiguousReservation(ledger, clock, reservation, providerName, refundError);
    }
    return c.json(
      { error: 'Provider response exceeded durable replay bounds', code: 'OUTPUT_TOO_LARGE' },
      500
    );
  }

  // G-03: Refund without charge if stale fallback was served
  if (options?.fallbackServed) {
    try {
      ledger.refund({
        operation_id: reservation.operationId,
        request_fingerprint: reservation.requestFingerprint,
        actual_microusd: 0,
        terminal_result: terminal,
        evidence: {
          kind: 'local_log',
          reference: `stale-fallback-${reservation.operationId.slice(0, 16)}`,
          summary: `Served stale cached response due to upstream failure (status ${options.upstreamStatus ?? 500})`,
        },
        audit_outcome: {
          kind: GevEvents.AuditOutcome,
          intent_id: reservation.operationId,
          ts: clock.iso(),
          status: 'ok',
          result: terminal,
          duration_ms: Math.max(0, clock.now() - reservation.startedAt),
        },
      });
      return null;
    } catch (refundError) {
      markAmbiguousReservation(ledger, clock, reservation, providerName, refundError);
      return c.json(
        {
          error: 'Provider action may have completed; settlement is ambiguous',
          code: 'OPERATION_IN_DOUBT',
          operation_id: reservation.operationId,
        },
        503
      );
    }
  }

  try {
    const settledMicrousd = terminal.status < 400 ? reservation.actualMicrousd : 0;
    const operation = ledger.settle({
      operation_id: reservation.operationId,
      request_fingerprint: reservation.requestFingerprint,
      actual_microusd: settledMicrousd,
      terminal_result: terminal,
      audit_outcome: {
        kind: GevEvents.AuditOutcome,
        intent_id: reservation.operationId,
        ts: clock.iso(),
        status: terminal.status < 400 ? 'ok' : 'error',
        result: terminal,
        duration_ms: Math.max(0, clock.now() - reservation.startedAt),
      },
    });
    if (!isFeedTerminal(operation.terminal_result)) {
      return c.json(
        { error: 'Provider response exceeded durable replay bounds', code: 'OUTPUT_TOO_LARGE' },
        500
      );
    }
    return null;
  } catch (error) {
    markAmbiguousReservation(ledger, clock, reservation, providerName, error);
    return c.json(
      {
        error: 'Provider action may have completed; settlement is ambiguous',
        code: 'OPERATION_IN_DOUBT',
        operation_id: reservation.operationId,
      },
      503
    );
  }
}

export function replayBillableOperation(
  c: Context,
  clock: SimClock,
  operation: LedgerOperation
): Response {
  if (!isFeedTerminal(operation.terminal_result)) {
    return c.json(
      {
        error: 'Stored terminal result cannot be replayed as a provider response',
        code: operation.state === 'DENIED' ? 'BUDGET_DENIED' : 'OUTPUT_TOO_LARGE',
        operation_id: operation.operation_id,
      },
      operation.state === 'DENIED' ? 429 : 409
    );
  }
  c.header('X-GEV-Idempotent-Replay', 'true');
  c.header('Content-Type', operation.terminal_result.contentType);
  const body = markResponseProvenanceCached(operation.terminal_result.body, {
    clock,
    cacheId: operation.operation_id,
    storedAtMs: clock.now(),
  });
  return c.newResponse(
    typeof body === 'string' ? body : JSON.stringify(body),
    operation.terminal_result.status as StatusCode
  );
}
