import { ProviderFeedHealthResponseSchema, SystemHealthResponseSchema } from '@gev/contracts';
import {
  createProviderRegistry,
  listProviderRegistryFeeds,
  summarizeProviderRegistry,
} from '@gev/providers';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/index.js';

describe('provider registry health composition', () => {
  it('keeps system health and feed health identities, modes, and counts aligned', async () => {
    const { app, providerRegistry } = createApp();
    const systemResponse = await app.request('/api/health');
    const feedResponse = await app.request('/api/feeds/health');
    const system = SystemHealthResponseSchema.parse(await systemResponse.json());
    const feedHealth = ProviderFeedHealthResponseSchema.parse(await feedResponse.json());

    expect(system.provider_registry).toEqual(providerRegistry);
    expect(feedHealth.counts).toEqual(summarizeProviderRegistry(providerRegistry));
    expect(feedHealth.requested_mode).toBe(providerRegistry.requested_mode);
    expect(feedHealth.feeds).toEqual(listProviderRegistryFeeds(providerRegistry));
    expect(feedHealth.registry_version).toBe(2);
    expect(feedHealth.feeds.find((feed) => feed.id === 'flights')).toMatchObject({
      source: { license_id: 'opensky-terms-of-use' },
      freshness: { status: 'defined', fresh_for_seconds: 5 },
    });
  });

  it('reports requested live mode as degraded when seed-only feeds are unavailable', async () => {
    const providerRegistry = createProviderRegistry({ requestedMode: 'live' });
    const { app } = createApp({ providerRegistry });
    const system = SystemHealthResponseSchema.parse(
      await (await app.request('/api/health')).json()
    );
    const feedHealth = ProviderFeedHealthResponseSchema.parse(
      await (await app.request('/api/feeds/health')).json()
    );

    expect(system.status).toBe('degraded');
    expect(system.seed_mode).toBe(false);
    expect(feedHealth.status).toBe('degraded');
    expect(feedHealth.counts.providers.active).toBe(6);
  });
});
