import crypto from 'node:crypto';
import {
  GevEvents,
  type LedgerOperation,
  type LedgerReservationResult,
  M3_FINGERPRINT_VERSION,
  M3_LEDGER_CONTRACT_VERSION,
} from '@gev/contracts';
import type { SimClock } from '@gev/core';
import { SystemClock } from '@gev/core';
import { LedgerOperationError, type SqliteBudgetLedger } from '@gev/governance';
import { markResponseProvenanceCached } from '@gev/providers';
import type { Context, Next } from 'hono';
import {
  feedFailureResult,
  isFeedTerminal,
  readFeedTerminalResponse,
  withRequestTimeout,
} from './billableFeedResult.js';
import { DEFAULT_PROVIDER_TIERS, type ProviderTierConfig } from './costGovernorConfig.js';

export { DEFAULT_PROVIDER_TIERS, type ProviderTierConfig } from './costGovernorConfig.js';

const MAX_CACHE_ENTRIES = 200;
const BILLABLE_REQUEST_TIMEOUT_MS = 30_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CacheEntry {
  body: unknown;
  status: number;
  timestamp: number;
  etag: string;
  cacheId: string;
}

interface ProviderState {
  cooldownUntil: number;
  cache: Map<string, CacheEntry>;
}

interface ActiveReservation {
  operationId: string;
  requestFingerprint: string;
  startedAt: number;
  actualMicrousd: number;
}

export interface CostGovernorOptions {
  clock?: SimClock;
  budgetLedger?: SqliteBudgetLedger;
  tiers?: Record<string, ProviderTierConfig>;
}

/** Enforces provider TTLs, cooldowns, stale fallback, and budget tracking. */
export class CostGovernor {
  private readonly clock: SimClock;
  private readonly budgetLedger?: SqliteBudgetLedger;
  private readonly tiers: Record<string, ProviderTierConfig>;
  private readonly providerStates: Map<string, ProviderState> = new Map();

  constructor(options: CostGovernorOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.budgetLedger = options.budgetLedger;
    this.tiers = options.tiers ?? DEFAULT_PROVIDER_TIERS;
  }

  /** Returns Hono middleware for a provider feed. */
  middleware(providerName: string) {
    const tier = this.tiers[providerName] ?? {
      ttlSeconds: 10,
      costPerFetchUsd: 0,
      maxStaleSeconds: 60,
    };

    return async (c: Context, next: Next) => {
      const now = this.clock.now();
      const state = this.getProviderState(providerName);
      const cacheKey = c.req.url;
      const cached = state.cache.get(cacheKey);

      if (state.cooldownUntil > now) {
        const remainingCooldownSec = Math.ceil((state.cooldownUntil - now) / 1000);
        c.header('Retry-After', remainingCooldownSec.toString());
        c.header('X-GEV-Cooldown-Active', 'true');

        if (cached) {
          c.header('X-GEV-Stale', 'true');
          c.header('X-GEV-Cache-Source', 'cooldown-fallback');
          return c.json(this.readCachedBody(cached), cached.status as 200);
        }

        return c.json(
          {
            error: 'Provider in active cooldown due to upstream 429 rate limit',
            cooldown_seconds: remainingCooldownSec,
          },
          429
        );
      }

      if (cached && now - cached.timestamp < tier.ttlSeconds * 1000) {
        const ageSec = Math.floor((now - cached.timestamp) / 1000);
        c.header('X-GEV-Cache', 'HIT');
        c.header('X-GEV-Cache-Age-Sec', ageSec.toString());
        c.header('X-GEV-TTL-Sec', tier.ttlSeconds.toString());
        return c.json(this.readCachedBody(cached), cached.status as 200);
      }

      let activeReservation: ActiveReservation | undefined;
      if (tier.costPerFetchUsd > 0) {
        const reservation = this.reserveBillable(c, providerName, cacheKey, tier, cached);
        if (reservation instanceof Response) return reservation;
        activeReservation = reservation;
      }

      // Proceed with upstream fetch
      try {
        await withRequestTimeout(next(), BILLABLE_REQUEST_TIMEOUT_MS);
      } catch (error) {
        if (activeReservation) {
          this.markAmbiguous(activeReservation, providerName, error);
          c.res = c.json(
            {
              error: 'Billable provider outcome is ambiguous and requires human reconciliation',
              code: 'OPERATION_IN_DOUBT',
              operation_id: activeReservation.operationId,
            },
            503
          );
          return;
        }
        throw error;
      }

      // Inspect response status and headers
      const status = c.res.status;
      const retryAfterHeader = c.res.headers.get('Retry-After');

      if (status === 429 && retryAfterHeader) {
        const retrySec = this.parseRetryAfter(retryAfterHeader);
        state.cooldownUntil = now + retrySec * 1000;
      }

      // If successful, update cached response and record spend
      if (status >= 200 && status < 300) {
        const cloned = c.res.clone();
        try {
          const jsonBody = await cloned.json();

          // Evict oldest entry if cache is full
          if (state.cache.size >= MAX_CACHE_ENTRIES) {
            let oldestKey = '';
            let oldestTs = Number.POSITIVE_INFINITY;
            for (const [key, entry] of state.cache) {
              if (entry.timestamp < oldestTs) {
                oldestTs = entry.timestamp;
                oldestKey = key;
              }
            }
            if (oldestKey) state.cache.delete(oldestKey);
          }

          state.cache.set(cacheKey, {
            body: jsonBody,
            status,
            timestamp: now,
            etag: `W/"${now}"`,
            cacheId: this.createCacheId(providerName, cacheKey, now),
          });
          c.header('X-GEV-Cache', 'MISS');
          c.header('X-GEV-TTL-Sec', tier.ttlSeconds.toString());
        } catch {
          // Ignore non-JSON bodies (e.g. audio streams)
        }
      } else if (cached && now - cached.timestamp < tier.maxStaleSeconds * 1000) {
        // Staleness fallback on 5xx or rate limits — replace c.res (H2 fix)
        c.res = new Response(JSON.stringify(this.readCachedBody(cached)), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-GEV-Stale': 'true',
            'X-GEV-Cache-Source': 'error-fallback',
          },
        });
      }

      if (activeReservation) {
        const settlementFailure = await this.settleBillable(c, activeReservation, providerName);
        if (settlementFailure) {
          c.res = settlementFailure;
          return;
        }
      }

      return;
    };
  }

  private parseRetryAfter(header: string | null): number {
    if (!header) return 30;
    const seconds = Number.parseInt(header, 10);
    if (!Number.isNaN(seconds)) {
      return Math.min(1800, Math.max(30, seconds));
    }
    const dateMs = Date.parse(header);
    if (!Number.isNaN(dateMs)) {
      const diffSec = Math.ceil((dateMs - this.clock.now()) / 1000);
      return Math.min(1800, Math.max(30, diffSec));
    }
    return 30;
  }

  private getProviderState(providerName: string): ProviderState {
    let state = this.providerStates.get(providerName);
    if (!state) {
      state = {
        cooldownUntil: 0,
        cache: new Map(),
      };
      this.providerStates.set(providerName, state);
    }
    return state;
  }

  private createCacheId(providerName: string, cacheKey: string, storedAtMs: number): string {
    const digest = crypto
      .createHash('sha256')
      .update(`${providerName}\n${cacheKey}\n${storedAtMs}`, 'utf8')
      .digest('hex');
    return `cache-${digest.slice(0, 32)}`;
  }

  private readCachedBody(cached: CacheEntry): unknown {
    return markResponseProvenanceCached(cached.body, {
      clock: this.clock,
      cacheId: cached.cacheId,
      storedAtMs: cached.timestamp,
    });
  }

  private reserveBillable(
    c: Context,
    providerName: string,
    cacheKey: string,
    tier: ProviderTierConfig,
    cached: CacheEntry | undefined
  ): ActiveReservation | Response {
    const ledger = this.budgetLedger;
    if (!ledger) {
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
    const startedAt = this.clock.now();
    const requestDigest = crypto.createHash('sha256').update(cacheKey, 'utf8').digest('hex');
    let result: LedgerReservationResult;
    try {
      result = ledger.reserve({
        operation_id: operationId,
        fingerprint_components: {
          contract_version: M3_LEDGER_CONTRACT_VERSION,
          fingerprint_version: M3_FINGERPRINT_VERSION,
          actor: 'system',
          tenant_id: null,
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
          ts: this.clock.iso(),
          actor: 'system',
          action: `feed.fetch.${providerName}`,
          target: providerName,
          params: { request_digest: requestDigest },
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
      if (cached) {
        c.header('X-GEV-Stale', 'true');
        c.header('X-GEV-Cache-Source', 'budget-fallback');
        return c.json(this.readCachedBody(cached), cached.status as 200);
      }
      return c.json(
        {
          error: 'STASIS: Budget reservation denied for feed',
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
      return this.replay(c, result.operation);
    }

    try {
      const executing = ledger.startExecution(operationId, result.operation.request_fingerprint);
      return {
        operationId,
        requestFingerprint: executing.request_fingerprint,
        startedAt,
        actualMicrousd: Math.ceil(tier.costPerFetchUsd * 1_000_000),
      };
    } catch (error) {
      if (error instanceof LedgerOperationError && error.code === 'RESERVATION_EXPIRED') {
        this.refundExpired(result.operation, providerName);
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

  private refundExpired(operation: LedgerOperation, providerName: string): void {
    const terminal = feedFailureResult(
      operation.operation_id,
      'RESERVATION_EXPIRED',
      'Reservation expired before dispatch'
    );
    this.budgetLedger?.refund({
      operation_id: operation.operation_id,
      request_fingerprint: operation.request_fingerprint,
      actual_microusd: 0,
      terminal_result: terminal,
      audit_outcome: {
        kind: GevEvents.AuditOutcome,
        intent_id: operation.operation_id,
        ts: this.clock.iso(),
        status: 'blocked',
        result: terminal,
        error: `Reservation expired before ${providerName} dispatch`,
        duration_ms: 0,
      },
      evidence: null,
    });
  }

  private async settleBillable(
    c: Context,
    reservation: ActiveReservation,
    providerName: string
  ): Promise<Response | null> {
    const terminal = await readFeedTerminalResponse(c.res);
    const ledger = this.budgetLedger;
    if (!ledger) {
      return c.json(
        { error: 'Durable budget ledger is unavailable', code: 'LEDGER_UNAVAILABLE' },
        503
      );
    }
    try {
      const operation = ledger.settle({
        operation_id: reservation.operationId,
        request_fingerprint: reservation.requestFingerprint,
        actual_microusd: reservation.actualMicrousd,
        terminal_result: terminal,
        audit_outcome: {
          kind: GevEvents.AuditOutcome,
          intent_id: reservation.operationId,
          ts: this.clock.iso(),
          status: terminal.status < 400 ? 'ok' : 'error',
          result: terminal,
          duration_ms: Math.max(0, this.clock.now() - reservation.startedAt),
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
      this.markAmbiguous(reservation, providerName, error);
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

  private markAmbiguous(
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
      this.budgetLedger?.markInDoubt({
        operation_id: reservation.operationId,
        request_fingerprint: reservation.requestFingerprint,
        reason: message,
        audit_outcome: {
          kind: GevEvents.AuditOutcome,
          intent_id: reservation.operationId,
          ts: this.clock.iso(),
          status: 'error',
          result: terminal,
          error: terminal.error,
          duration_ms: Math.max(0, this.clock.now() - reservation.startedAt),
        },
      });
    } catch {
      // The public result remains typed and fail closed even if storage is unavailable.
    }
  }

  private replay(c: Context, operation: LedgerOperation): Response {
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
    return c.body(
      typeof operation.terminal_result.body === 'string'
        ? operation.terminal_result.body
        : JSON.stringify(operation.terminal_result.body),
      operation.terminal_result.status as 200
    );
  }
}
