import crypto from 'node:crypto';
import {
  GevEvents,
  type LedgerReservationResult,
  M3_FINGERPRINT_VERSION,
  M3_LEDGER_CONTRACT_VERSION,
} from '@gev/contracts';
import type { SimClock } from '@gev/core';
import { LedgerOperationError, type SqliteBudgetLedger } from '@gev/governance';
import type { Context } from 'hono';
import type { ProviderTierConfig } from './costGovernorConfig.js';
import {
  type ActiveReservation,
  refundExpiredReservation,
  replayBillableOperation,
} from './costGovernorSettlement.js';

export const BILLABLE_REQUEST_TIMEOUT_MS = 30_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Reserves a billable provider request against the shared M3 ledger or returns a terminal response. */
export function reserveBillableFeedOperation(options: {
  c: Context;
  clock: SimClock;
  budgetLedger?: SqliteBudgetLedger;
  providerName: string;
  cacheKey: string;
  tier: ProviderTierConfig;
  tenantId: string;
  readCachedFallback: () => Response | null;
}): ActiveReservation | Response {
  const { c, clock, budgetLedger, providerName, cacheKey, tier, tenantId, readCachedFallback } =
    options;
  if (!budgetLedger) {
    return c.json(
      { error: 'Durable budget ledger is unavailable', code: 'LEDGER_UNAVAILABLE' },
      503
    );
  }
  const suppliedId = c.req.header('Idempotency-Key');
  const operationId = suppliedId ?? crypto.randomUUID();
  c.header('X-GEV-Operation-Id', operationId);
  if (!UUID_PATTERN.test(operationId)) {
    return c.json({ error: 'Idempotency-Key must be a UUID', code: 'INVALID_OPERATION_ID' }, 400);
  }
  const startedAt = clock.now();
  const requestDigest = crypto.createHash('sha256').update(cacheKey, 'utf8').digest('hex');
  let result: LedgerReservationResult;
  try {
    result = budgetLedger.reserve({
      operation_id: operationId,
      fingerprint_components: {
        contract_version: M3_LEDGER_CONTRACT_VERSION,
        fingerprint_version: M3_FINGERPRINT_VERSION,
        actor: 'system',
        tenant_id: tenantId,
        action: `feed.fetch.${providerName}`,
        input: { provider: providerName, request_digest: requestDigest },
        task_ref: `provider-fetch:${providerName}`,
        is_mutating: false,
        estimate: {
          currency: 'usd',
          min: tier.costPerFetchUsd,
          max: tier.costPerFetchUsd,
        },
      },
      deadline_at: new Date(startedAt + BILLABLE_REQUEST_TIMEOUT_MS).toISOString(),
      audit_intent: {
        kind: GevEvents.AuditIntent,
        id: operationId,
        ts: clock.iso(),
        actor: 'system',
        action: `feed.fetch.${providerName}`,
        target: providerName,
        params: { request_digest: requestDigest, tenant_id: tenantId },
        task_ref: `provider-fetch:${providerName}`,
      },
    });
  } catch {
    return c.json(
      { error: 'Durable budget ledger is unavailable', code: 'LEDGER_UNAVAILABLE' },
      503
    );
  }

  if (result.kind === 'denied') {
    c.header('X-GEV-Budget-Exceeded', 'true');
    const cachedResponse = readCachedFallback();
    if (cachedResponse) return cachedResponse;
    return c.json(
      {
        error: `STASIS: Budget reservation denied for feed (tenant: ${tenantId})`,
        code: 'BUDGET_DENIED',
        operation_id: operationId,
      },
      429
    );
  }
  if (result.kind === 'conflict') {
    return c.json(
      { error: result.message, code: 'IDEMPOTENCY_CONFLICT', operation_id: operationId },
      409
    );
  }
  if (result.kind === 'in_progress') {
    c.header('Retry-After', '1');
    return c.json(
      {
        error: 'Original operation is still active',
        code: 'OPERATION_IN_PROGRESS',
        operation_id: operationId,
      },
      409
    );
  }
  if (result.kind === 'in_doubt') {
    return c.json(
      {
        error: 'Original operation requires human reconciliation',
        code: 'OPERATION_IN_DOUBT',
        operation_id: operationId,
      },
      409
    );
  }
  if (result.kind === 'replay') {
    return replayBillableOperation(c, clock, result.operation);
  }

  try {
    const executing = budgetLedger.startExecution(
      operationId,
      result.operation.request_fingerprint
    );
    return {
      operationId,
      requestFingerprint: executing.request_fingerprint,
      startedAt,
      actualMicrousd: Math.ceil(tier.costPerFetchUsd * 1_000_000),
    };
  } catch (error) {
    if (error instanceof LedgerOperationError && error.code === 'RESERVATION_EXPIRED') {
      refundExpiredReservation(budgetLedger, clock, result.operation, providerName);
      return c.json(
        {
          error: 'Reservation expired before dispatch',
          code: 'RESERVATION_EXPIRED',
          operation_id: operationId,
        },
        409
      );
    }
    return c.json(
      { error: 'Durable budget ledger is unavailable', code: 'LEDGER_UNAVAILABLE' },
      503
    );
  }
}
