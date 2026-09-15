import crypto from 'node:crypto';
import {
  type AuthenticatedIdentityContext,
  GevEvents,
  type LedgerReservationResult,
  M3_FINGERPRINT_VERSION,
  M3_LEDGER_CONTRACT_VERSION,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import { LedgerOperationError, type SqliteBudgetLedger } from '@gev/governance';
import { markResponseProvenanceCached } from '@gev/providers';
import type { Context, Next } from 'hono';
import { withRequestTimeout } from './billableFeedResult.js';
import { DEFAULT_PROVIDER_TIERS, type ProviderTierConfig } from './costGovernorConfig.js';
import {
  type ActiveReservation,
  markAmbiguousReservation,
  refundExpiredReservation,
  replayBillableOperation,
  settleBillableReservation,
} from './costGovernorSettlement.js';
import type { InMemoryRateLimiter, OpsAuthAdapter } from './opsAuth.js';
export { DEFAULT_PROVIDER_TIERS, type ProviderTierConfig };

const MAX_CACHE_ENTRIES = 200;
const BILLABLE_REQUEST_TIMEOUT_MS = 30_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CacheEntry {
  body: unknown;
  cachedBody?: unknown;
  status: number;
  timestamp: number;
  etag: string;
  cacheId: string;
}

interface ProviderState {
  cooldownUntil: number;
  tenantCaches: Map<string, Map<string, CacheEntry>>;
}

export interface CostGovernorOptions {
  clock?: SimClock;
  budgetLedger?: SqliteBudgetLedger;
  tiers?: Record<string, ProviderTierConfig>;
  isProviderEnabled?: (providerName: string) => boolean;
  requireAuth?: boolean;
  rateLimiter?: InMemoryRateLimiter;
  tenantRateLimits?: Record<string, number>;
  auth?: OpsAuthAdapter;
}

/** Enforces provider TTLs, cooldowns, stale fallback, per-tenant caching, kill-switches, and budget tracking. */
export class CostGovernor {
  private readonly clock: SimClock;
  private readonly budgetLedger?: SqliteBudgetLedger;
  private readonly tiers: Record<string, ProviderTierConfig>;
  private readonly isProviderEnabled?: (providerName: string) => boolean;
  private readonly requireAuth: boolean;
  private readonly rateLimiter?: InMemoryRateLimiter;
  private readonly tenantRateLimits?: Record<string, number>;
  private readonly auth?: OpsAuthAdapter;
  private readonly providerStates: Map<string, ProviderState> = new Map();

  constructor(options: CostGovernorOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.budgetLedger = options.budgetLedger;
    this.tiers = options.tiers
      ? { ...DEFAULT_PROVIDER_TIERS, ...options.tiers }
      : DEFAULT_PROVIDER_TIERS;
    this.isProviderEnabled = options.isProviderEnabled;
    this.rateLimiter = options.rateLimiter;
    this.tenantRateLimits = options.tenantRateLimits;
    this.auth = options.auth;
    this.requireAuth =
      options.requireAuth ??
      (process.env.GEV_REQUIRE_AUTH === '1' || process.env.NODE_ENV === 'production');
  }

  invalidate(providerName: string): void {
    this.providerStates.delete(providerName);
  }

  invalidateTenant(providerName: string, tenantId: string): void {
    const state = this.providerStates.get(providerName);
    if (state) {
      state.tenantCaches.delete(tenantId);
    }
  }

  middleware(providerName: string) {
    const tier = this.tiers[providerName];
    if (!tier) {
      throw new Error(`Cost governor: no registered provider tier for '${providerName}'`);
    }

    return async (c: Context, next: Next) => {
      // 1. Kill-switch check (fail closed immediately)
      if (this.isProviderEnabled && !this.isProviderEnabled(providerName)) {
        return c.json(
          {
            error: `Provider '${providerName}' is disabled by kill-switch policy`,
            code: 'KILL_SWITCH_ACTIVE',
          },
          503
        );
      }

      // 2. Resolve request tenant context
      let tenantId =
        (c.get('opsTenantId') as string | undefined) ??
        (c.get('opsIdentity') as AuthenticatedIdentityContext | undefined)?.tenant_id ??
        (c.var as { opsTenantId?: string } | undefined)?.opsTenantId;

      if (!tenantId && this.auth) {
        const authHeader = c.req.header('Authorization');
        const requestedTenant = c.req.header('X-GEV-Tenant');
        const decision = await this.auth.authenticate(authHeader, requestedTenant);
        if (decision.kind === 'authenticated') {
          tenantId = decision.identity.tenant_id;
          c.set('opsIdentity', decision.identity);
          c.set('opsTenantId', decision.identity.tenant_id);
          c.set('opsActor', decision.actor);
          c.set('opsAuthenticated', true);
        }
      }

      if (!tenantId && !this.requireAuth) {
        tenantId = 'tenant-local';
      }

      if (!tenantId) {
        return c.json(
          {
            error: 'Unauthorized: Authenticated tenant required for quota-consuming endpoint',
            code: 'UNAUTHENTICATED_QUOTA_ACCESS',
          },
          401
        );
      }

      const now = this.clock.now();
      const state = this.getProviderState(providerName);
      const tenantCache = this.getTenantCache(state, tenantId);
      const cacheKey = c.req.url;
      const cached = tenantCache.get(cacheKey);

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

      // 4. Per-tenant rate limit on cache misses
      if (this.rateLimiter) {
        const limit = this.tenantRateLimits?.[providerName] ?? tier.requestsPerMinute ?? 60;
        const rateDecision = this.rateLimiter.consume(`provider:${providerName}`, tenantId, limit);
        if (!rateDecision.allowed) {
          c.header('Retry-After', String(rateDecision.retryAfterSeconds));
          c.header('X-GEV-Tenant-Rate-Limited', 'true');
          return c.json(
            {
              error: `Per-tenant rate limit exceeded for provider '${providerName}' (tenant: ${tenantId})`,
              code: 'TENANT_RATE_LIMITED',
            },
            429
          );
        }
      }

      let activeReservation: ActiveReservation | undefined;
      if (tier.costPerFetchUsd > 0) {
        const reservation = this.reserveBillable(c, providerName, cacheKey, tier, cached, tenantId);
        if (reservation instanceof Response) return reservation;
        activeReservation = reservation;
      }

      // Proceed with upstream fetch
      try {
        await withRequestTimeout(next(), BILLABLE_REQUEST_TIMEOUT_MS);
      } catch (error) {
        if (activeReservation) {
          markAmbiguousReservation(
            this.budgetLedger,
            this.clock,
            activeReservation,
            providerName,
            error
          );
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

          // Evict oldest entry in this tenant's cache if full
          if (tenantCache.size >= MAX_CACHE_ENTRIES) {
            let oldestKey = '';
            let oldestTs = Number.POSITIVE_INFINITY;
            for (const [key, entry] of tenantCache) {
              if (entry.timestamp < oldestTs) {
                oldestTs = entry.timestamp;
                oldestKey = key;
              }
            }
            if (oldestKey) tenantCache.delete(oldestKey);
          }

          const cacheId = this.createCacheId(providerName, cacheKey, now);
          const cachedBody = markResponseProvenanceCached(jsonBody, {
            clock: this.clock,
            cacheId,
            storedAtMs: now,
          });

          tenantCache.set(cacheKey, {
            body: jsonBody,
            cachedBody,
            status,
            timestamp: now,
            etag: `W/"${now}"`,
            cacheId,
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
        const settlementFailure = await settleBillableReservation(
          c,
          this.budgetLedger,
          this.clock,
          activeReservation,
          providerName
        );
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
      state = { cooldownUntil: 0, tenantCaches: new Map() };
      this.providerStates.set(providerName, state);
    }
    return state;
  }

  private getTenantCache(state: ProviderState, tenantId: string): Map<string, CacheEntry> {
    let cache = state.tenantCaches.get(tenantId);
    if (!cache) {
      cache = new Map();
      state.tenantCaches.set(tenantId, cache);
    }
    return cache;
  }

  private createCacheId(providerName: string, cacheKey: string, storedAtMs: number): string {
    const digest = crypto
      .createHash('sha256')
      .update(`${providerName}\n${cacheKey}\n${storedAtMs}`, 'utf8')
      .digest('hex');
    return `cache-${digest.slice(0, 32)}`;
  }

  private readCachedBody(cached: CacheEntry): unknown {
    return (
      cached.cachedBody ??
      markResponseProvenanceCached(cached.body, {
        clock: this.clock,
        cacheId: cached.cacheId,
        storedAtMs: cached.timestamp,
      })
    );
  }

  private reserveBillable(
    c: Context,
    providerName: string,
    cacheKey: string,
    tier: ProviderTierConfig,
    cached: CacheEntry | undefined,
    tenantId: string
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
          ts: this.clock.iso(),
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
      if (cached) {
        c.header('X-GEV-Stale', 'true');
        c.header('X-GEV-Cache-Source', 'budget-fallback');
        return c.json(this.readCachedBody(cached), cached.status as 200);
      }
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
      return replayBillableOperation(c, this.clock, result.operation);
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
        refundExpiredReservation(this.budgetLedger, this.clock, result.operation, providerName);
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
}
