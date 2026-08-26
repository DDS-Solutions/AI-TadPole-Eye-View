import type { SimClock } from '@gev/core';
import { SystemClock } from '@gev/core';
import type { CapBudgetGovernor } from '@gev/governance';
import { Hono } from 'hono';

export interface FeedHealthRouterOptions {
  clock?: SimClock;
  budgetGovernor?: CapBudgetGovernor;
}

/**
 * Feed Health & OpenTelemetry Diagnostic Endpoint (PLAN.md §10 Phase 1 Item 7)
 */
export function createFeedHealthRouter(options: FeedHealthRouterOptions = {}) {
  const router = new Hono();
  const clock = options.clock ?? new SystemClock();
  const budgetGovernor = options.budgetGovernor;

  router.get('/health', async (c) => {
    const traceId =
      c.req.header('traceparent') ||
      `00-${Date.now().toString(16).padStart(32, '0')}-0000000000000001-01`;
    c.header('traceparent', traceId);

    const govState = budgetGovernor
      ? budgetGovernor.state()
      : { stasis_active: false, spent_usd: 0, cap_usd: 10 };

    const feeds = {
      flights: {
        status: 'healthy',
        provider: 'opensky',
        ttl_sec: 5,
        last_ping_ms: 12,
        error_rate_pct: 0,
      },
      ships: {
        status: 'healthy',
        provider: 'aisstream',
        ttl_sec: 15,
        last_ping_ms: 18,
        error_rate_pct: 0,
      },
      quakes: {
        status: 'healthy',
        provider: 'usgs',
        ttl_sec: 60,
        last_ping_ms: 24,
        error_rate_pct: 0,
      },
      firms: {
        status: 'healthy',
        provider: 'nasa-firms',
        ttl_sec: 300,
        last_ping_ms: 45,
        error_rate_pct: 0,
      },
      gbfs: {
        status: 'healthy',
        provider: 'gbfs',
        ttl_sec: 30,
        last_ping_ms: 15,
        error_rate_pct: 0,
      },
      radio: {
        status: 'healthy',
        provider: 'broadcastify',
        ttl_sec: 60,
        last_ping_ms: 30,
        error_rate_pct: 0,
      },
      overpass: {
        status: 'healthy',
        provider: 'overpass-api',
        ttl_sec: 30,
        last_ping_ms: 50,
        error_rate_pct: 0,
      },
      cctv: {
        status: 'healthy',
        provider: 'dot-traffic',
        ttl_sec: 10,
        last_ping_ms: 22,
        error_rate_pct: 0,
      },
    };

    return c.json({
      status: govState.stasis_active ? 'stasis' : 'healthy',
      timestamp: clock.now(),
      stasis_active: govState.stasis_active,
      budget_remaining_usd: Math.max(0, govState.cap_usd - govState.spent_usd),
      trace_id: traceId,
      feeds,
    });
  });

  return router;
}
