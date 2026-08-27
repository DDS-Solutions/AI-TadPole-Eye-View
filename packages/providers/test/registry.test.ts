import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  createProviderRegistry,
  listProviderRegistryFeeds,
  renderProviderRegistryMarkdown,
  summarizeProviderRegistry,
  withDisabledProviders,
} from '../src/index.js';

describe('typed provider registry', () => {
  it('derives honest seed provider, feed, and layer counts without network access', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const registry = createProviderRegistry({ requestedMode: 'seed' });
    const counts = summarizeProviderRegistry(registry);

    expect(counts).toEqual({
      providers: { total: 12, active: 10 },
      feeds: { total: 12, active: 10 },
      layers: { total: 12, active: 9 },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('keeps feed, layer, and provider identities distinct', () => {
    const registry = createProviderRegistry({ requestedMode: 'seed' });
    const ais = registry.providers.find((provider) => provider.id === 'aisstream');

    expect(ais?.feeds[0]?.id).toBe('ships');
    expect(ais?.layers[0]?.id).toBe('marine');
  });

  it('does not mark planned, incomplete, or unsupported-mode entries active', () => {
    const seedRegistry = createProviderRegistry({ requestedMode: 'seed' });
    const satellite = seedRegistry.providers.find((provider) => provider.id === 'celestrak');
    const cables = seedRegistry.providers.find(
      (provider) => provider.id === 'telegeography-cables'
    );

    expect(satellite).toMatchObject({
      implementation: 'planned',
      mode: 'unavailable',
      health: 'unavailable',
    });
    expect(cables).toMatchObject({
      implementation: 'incomplete',
      mode: 'download_pack',
      health: 'unavailable',
    });

    const liveCounts = summarizeProviderRegistry(createProviderRegistry({ requestedMode: 'live' }));
    expect(liveCounts).toEqual({
      providers: { total: 12, active: 6 },
      feeds: { total: 12, active: 6 },
      layers: { total: 12, active: 5 },
    });
  });

  it('derives degraded feed health from a disabled provider without mutating registry truth', () => {
    const registry = createProviderRegistry({ requestedMode: 'seed' });
    const disabled = withDisabledProviders(registry, ['opensky']);
    const feeds = listProviderRegistryFeeds(disabled);

    expect(feeds.find((feed) => feed.provider === 'opensky')?.status).toBe('degraded');
    expect(listProviderRegistryFeeds(registry)[0]?.status).toBe('healthy');
  });

  it('matches the committed generated documentation artifact', () => {
    const generatedPath = fileURLToPath(
      new URL('../../../docs/generated/provider-registry.md', import.meta.url)
    );
    const expected = renderProviderRegistryMarkdown(
      createProviderRegistry({ requestedMode: 'seed' })
    );
    expect(fs.readFileSync(generatedPath, 'utf8')).toBe(expected);
  });
});
