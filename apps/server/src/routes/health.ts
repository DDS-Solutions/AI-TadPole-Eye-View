import {
  ProviderFeedHealthResponseSchema,
  type ProviderRegistry,
  ProviderRegistrySchema,
} from '@gev/contracts';
import type { SimClock } from '@gev/core';
import { SystemClock } from '@gev/core';
import type { CapBudgetGovernor } from '@gev/governance';
import {
  createConfiguredProviderRegistry,
  listProviderRegistryFeeds,
  summarizeProviderRegistry,
} from '@gev/providers';
import { Hono } from 'hono';

export interface FeedHealthRouterOptions {
  clock?: SimClock;
  budgetGovernor?: CapBudgetGovernor;
  providerRegistry?: ProviderRegistry;
  getProviderRegistry?: () => ProviderRegistry;
}

/**
 * Feed Health & OpenTelemetry Diagnostic Endpoint (PLAN.md §10 Phase 1 Item 7)
 */
export function createFeedHealthRouter(options: FeedHealthRouterOptions = {}) {
  const router = new Hono();
  const clock = options.clock ?? new SystemClock();
  const budgetGovernor = options.budgetGovernor;
  const initialProviderRegistry = ProviderRegistrySchema.parse(
    options.providerRegistry ?? createConfiguredProviderRegistry()
  );
  const getProviderRegistry = options.getProviderRegistry ?? (() => initialProviderRegistry);

  router.get('/health', async (c) => {
    const providerRegistry = ProviderRegistrySchema.parse(getProviderRegistry());
    const traceId =
      c.req.header('traceparent') ||
      `00-${Math.floor(clock.now()).toString(16).padStart(32, '0')}-0000000000000001-01`;
    c.header('traceparent', traceId);

    const govState = budgetGovernor
      ? budgetGovernor.state()
      : { stasis_active: false, spent_usd: 0, cap_usd: 10 };

    const feeds = listProviderRegistryFeeds(providerRegistry);
    const implementedFeeds = feeds.filter((feed) => feed.implementation === 'implemented');
    const registryStatus = implementedFeeds.every((feed) => feed.status === 'unavailable')
      ? 'unavailable'
      : implementedFeeds.some((feed) => feed.status !== 'healthy')
        ? 'degraded'
        : 'healthy';

    return c.json(
      ProviderFeedHealthResponseSchema.parse({
        status: govState.stasis_active ? 'stasis' : registryStatus,
        timestamp: clock.now(),
        stasis_active: govState.stasis_active,
        budget_remaining_usd: Math.max(0, govState.cap_usd - govState.spent_usd),
        trace_id: traceId,
        registry_version: providerRegistry.version,
        requested_mode: providerRegistry.requested_mode,
        counts: summarizeProviderRegistry(providerRegistry),
        feeds,
      })
    );
  });

  return router;
}
