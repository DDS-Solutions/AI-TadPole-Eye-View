import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  activateProviderDownloadPack,
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
      providers: { total: 12, active: 12 },
      feeds: { total: 12, active: 12 },
      layers: { total: 12, active: 11 },
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

  it('publishes synthetic satellite mode and keeps unsupported modes unavailable', () => {
    const seedRegistry = createProviderRegistry({ requestedMode: 'seed' });
    const satellite = seedRegistry.providers.find((provider) => provider.id === 'celestrak');
    const cables = seedRegistry.providers.find((provider) => provider.id === 'submarine-cables');

    expect(satellite).toMatchObject({
      implementation: 'implemented',
      mode: 'seed',
      health: 'healthy',
      source: { license_id: 'gev-synthetic-fixture-mit' },
    });
    expect(cables).toMatchObject({
      implementation: 'implemented',
      mode: 'seed',
      health: 'healthy',
      source: { license_id: 'gev-synthetic-fixture-mit' },
    });

    const liveCounts = summarizeProviderRegistry(createProviderRegistry({ requestedMode: 'live' }));
    expect(liveCounts).toEqual({
      providers: { total: 12, active: 7 },
      feeds: { total: 12, active: 7 },
      layers: { total: 12, active: 6 },
    });
  });

  it('derives degraded feed health from a disabled provider without mutating registry truth', () => {
    const registry = createProviderRegistry({ requestedMode: 'seed' });
    const disabled = withDisabledProviders(registry, ['opensky']);
    const feeds = listProviderRegistryFeeds(disabled);

    expect(feeds.find((feed) => feed.provider === 'opensky')?.status).toBe('degraded');
    expect(listProviderRegistryFeeds(registry)[0]?.status).toBe('healthy');
    expect(summarizeProviderRegistry(disabled)).toEqual({
      providers: { total: 12, active: 11 },
      feeds: { total: 12, active: 11 },
      layers: { total: 12, active: 10 },
    });
  });

  it('does not count download-pack providers, feeds, or layers as active', () => {
    const registry = activateProviderDownloadPack(
      createProviderRegistry({ requestedMode: 'seed' }),
      'submarine-cables'
    );

    expect(summarizeProviderRegistry(registry)).toEqual({
      providers: { total: 12, active: 11 },
      feeds: { total: 12, active: 11 },
      layers: { total: 12, active: 10 },
    });
  });

  it('renders locked-live requested and runtime modes without exposing environment values', () => {
    vi.stubEnv('GEV_OPS_TOKEN', 'DOC_SECRET_SENTINEL');
    const nowSpy = vi.spyOn(Date, 'now');
    const registry = createProviderRegistry({
      requestedMode: 'live',
      unavailableProviderIds: ['celestrak'],
    });
    const markdown = renderProviderRegistryMarkdown(registry);
    const satelliteProviderRow = markdown
      .split('\n')
      .find((line) => line.startsWith('| `celestrak` | CelesTrak |'));

    expect(markdown).toContain('| Providers | 12 | 6 |');
    expect(satelliteProviderRow).toContain('| no | `implemented` | `live` | `unavailable` |');
    expect(markdown).not.toContain('DOC_SECRET_SENTINEL');
    expect(markdown).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(nowSpy).not.toHaveBeenCalled();
    nowSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('matches both committed marker-delimited generated documentation artifacts', () => {
    const registry = createProviderRegistry({ requestedMode: 'seed' });
    const markerPattern =
      /<!-- BEGIN GENERATED: provider-registry -->\r?\n([\s\S]*?)\r?\n<!-- END GENERATED: provider-registry -->/;
    const documents = [
      {
        path: fileURLToPath(new URL('../../../DATA_SOURCES.md', import.meta.url)),
        expected: renderProviderRegistryMarkdown(registry, {
          headingLevel: 3,
          documentationHref: (documentationPath) => `./${documentationPath}`,
        }),
      },
      {
        path: fileURLToPath(
          new URL('../../../docs/generated/provider-registry.md', import.meta.url)
        ),
        expected: renderProviderRegistryMarkdown(registry, {
          headingLevel: 2,
          documentationHref: (documentationPath) =>
            `../${documentationPath.replace(/^docs\//, '')}`,
        }),
      },
    ];

    for (const document of documents) {
      const match = fs.readFileSync(document.path, 'utf8').match(markerPattern);
      expect(match?.[1]).toBe(document.expected.trimEnd());
    }
  });
});
