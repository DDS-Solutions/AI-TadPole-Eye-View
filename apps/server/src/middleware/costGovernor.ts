import type { SimClock } from '@gev/core';
import { SystemClock } from '@gev/core';
import type { CapBudgetGovernor } from '@gev/governance';
import type { Context, Next } from 'hono';

export interface ProviderTierConfig {
  ttlSeconds: number;
  costPerFetchUsd: number;
  maxStaleSeconds: number;
}

export const DEFAULT_PROVIDER_TIERS: Record<string, ProviderTierConfig> = {
  flights: { ttlSeconds: 5, costPerFetchUsd: 0.0001, maxStaleSeconds: 60 },
  ships: { ttlSeconds: 15, costPerFetchUsd: 0.0005, maxStaleSeconds: 300 },
  quakes: { ttlSeconds: 60, costPerFetchUsd: 0.0, maxStaleSeconds: 3600 },
  firms: { ttlSeconds: 300, costPerFetchUsd: 0.001, maxStaleSeconds: 7200 },
  gbfs: { ttlSeconds: 30, costPerFetchUsd: 0.0, maxStaleSeconds: 600 },
  weather: { ttlSeconds: 300, costPerFetchUsd: 0.0, maxStaleSeconds: 3600 },
  launches: { ttlSeconds: 600, costPerFetchUsd: 0.0, maxStaleSeconds: 7200 },
  radio: { ttlSeconds: 60, costPerFetchUsd: 0.0, maxStaleSeconds: 600 },
  cctv: { ttlSeconds: 10, costPerFetchUsd: 0.001, maxStaleSeconds: 120 },
  overpass: { ttlSeconds: 30, costPerFetchUsd: 0.0, maxStaleSeconds: 600 },
};

const MAX_CACHE_ENTRIES = 200;

interface CacheEntry {
  body: unknown;
  status: number;
  timestamp: number;
  etag: string;
}

interface ProviderState {
  cooldownUntil: number;
  cache: Map<string, CacheEntry>;
}

export interface CostGovernorOptions {
  clock?: SimClock;
  budgetGovernor?: CapBudgetGovernor;
  tiers?: Record<string, ProviderTierConfig>;
}

/**
 * Cost Governor Middleware (PLAN.md §10 Phase 1 Item 2)
 * Enforces per-provider TTL tiers, Retry-After cooldowns, staleness fallback, and budget tracking.
 */
export class CostGovernor {
  private readonly clock: SimClock;
  private readonly budgetGovernor?: CapBudgetGovernor;
  private readonly tiers: Record<string, ProviderTierConfig>;
  private readonly providerStates: Map<string, ProviderState> = new Map();

  constructor(options: CostGovernorOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.budgetGovernor = options.budgetGovernor;
    this.tiers = options.tiers ?? DEFAULT_PROVIDER_TIERS;
  }

  /**
   * Returns a Hono middleware handler for a specific provider feed.
   */
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

      // Check if provider is currently in a Retry-After cooldown
      if (state.cooldownUntil > now) {
        const remainingCooldownSec = Math.ceil((state.cooldownUntil - now) / 1000);
        c.header('Retry-After', remainingCooldownSec.toString());
        c.header('X-GEV-Cooldown-Active', 'true');

        if (cached) {
          c.header('X-GEV-Stale', 'true');
          c.header('X-GEV-Cache-Source', 'cooldown-fallback');
          return c.json(cached.body, cached.status as 200);
        }

        return c.json(
          {
            error: 'Provider in active cooldown due to upstream 429 rate limit',
            cooldown_seconds: remainingCooldownSec,
          },
          429
        );
      }

      // Check if cache is still fresh within TTL window
      if (cached && now - cached.timestamp < tier.ttlSeconds * 1000) {
        const ageSec = Math.floor((now - cached.timestamp) / 1000);
        c.header('X-GEV-Cache', 'HIT');
        c.header('X-GEV-Cache-Age-Sec', ageSec.toString());
        c.header('X-GEV-TTL-Sec', tier.ttlSeconds.toString());
        return c.json(cached.body, cached.status as 200);
      }

      // If budget governor is attached, verify spend budget is allowed
      if (this.budgetGovernor && tier.costPerFetchUsd > 0) {
        const verdict = this.budgetGovernor.check({
          action: `feed.fetch.${providerName}`,
          estimate: {
            currency: 'usd',
            min: tier.costPerFetchUsd,
            max: tier.costPerFetchUsd,
          },
        });

        if (!verdict.allowed) {
          c.header('X-GEV-Budget-Exceeded', 'true');
          if (cached) {
            c.header('X-GEV-Stale', 'true');
            c.header('X-GEV-Cache-Source', 'budget-fallback');
            return c.json(cached.body, cached.status as 200);
          }
          return c.json(
            {
              error: 'STASIS: Budget exceeded for feed',
              reason: verdict.reason,
              message: verdict.message,
            },
            429
          );
        }
      }

      // Proceed with upstream fetch
      await next();

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
          });
          c.header('X-GEV-Cache', 'MISS');
          c.header('X-GEV-TTL-Sec', tier.ttlSeconds.toString());

          // Record spend after successful upstream fetch (H1 fix)
          if (this.budgetGovernor && tier.costPerFetchUsd > 0) {
            this.budgetGovernor.recordSpend(tier.costPerFetchUsd);
          }
        } catch {
          // Ignore non-JSON bodies (e.g. audio streams)
        }
      } else if (cached && now - cached.timestamp < tier.maxStaleSeconds * 1000) {
        // Staleness fallback on 5xx or rate limits — replace c.res (H2 fix)
        c.res = new Response(JSON.stringify(cached.body), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-GEV-Stale': 'true',
            'X-GEV-Cache-Source': 'error-fallback',
          },
        });
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
      const diffSec = Math.ceil((dateMs - Date.now()) / 1000);
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
}
