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
import { OPERATIONAL_AWARENESS_PROVIDER_DEFINITIONS } from '../src/operationalRegistryDefinitions.js';
import { OPERATIONAL_IMAGERY_PROVIDER_DEFINITIONS } from '../src/operationalRegistryDefinitionsImagery.js';

const plannedOperationalDefinitions = [
  ...OPERATIONAL_AWARENESS_PROVIDER_DEFINITIONS,
  ...OPERATIONAL_IMAGERY_PROVIDER_DEFINITIONS,
];

describe('typed provider registry', () => {
  it('derives honest seed provider, feed, and layer counts without network access', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const registry = createProviderRegistry({ requestedMode: 'seed' });
    const counts = summarizeProviderRegistry(registry);

    expect(counts).toEqual({
      providers: { total: 19, active: 12 },
      feeds: { total: 22, active: 12 },
      layers: { total: 19, active: 11 },
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
      providers: { total: 19, active: 7 },
      feeds: { total: 22, active: 7 },
      layers: { total: 19, active: 6 },
    });
  });

  it('derives degraded feed health from a disabled provider without mutating registry truth', () => {
    const registry = createProviderRegistry({ requestedMode: 'seed' });
    const disabled = withDisabledProviders(registry, ['opensky']);
    const feeds = listProviderRegistryFeeds(disabled);

    expect(feeds.find((feed) => feed.provider === 'opensky')?.status).toBe('degraded');
    expect(listProviderRegistryFeeds(registry)[0]?.status).toBe('healthy');
    expect(summarizeProviderRegistry(disabled)).toEqual({
      providers: { total: 19, active: 11 },
      feeds: { total: 22, active: 11 },
      layers: { total: 19, active: 10 },
    });
  });

  it('does not count download-pack providers, feeds, or layers as active', () => {
    const registry = activateProviderDownloadPack(
      createProviderRegistry({ requestedMode: 'seed' }),
      'submarine-cables'
    );

    expect(summarizeProviderRegistry(registry)).toEqual({
      providers: { total: 19, active: 11 },
      feeds: { total: 22, active: 11 },
      layers: { total: 19, active: 10 },
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

    expect(markdown).toContain('| Providers | 19 | 6 |');
    expect(satelliteProviderRow).toContain('| no | `implemented` | `live` | `unavailable` |');
    expect(markdown).not.toContain('DOC_SECRET_SENTINEL');
    expect(markdown).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(nowSpy).not.toHaveBeenCalled();
    nowSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('keeps every accepted operational source planned, unavailable, bounded, and documented', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const nowSpy = vi.spyOn(Date, 'now');
    const seedRegistry = createProviderRegistry({ requestedMode: 'seed' });
    const liveRegistry = createProviderRegistry({ requestedMode: 'live' });

    expect(plannedOperationalDefinitions).toHaveLength(7);
    expect(
      plannedOperationalDefinitions.map((definition) => definition.source_access.decision_rank)
    ).toEqual([1, 2, 3, 4, 5, 6, 7]);

    const killSwitches = new Set<string>();
    for (const definition of plannedOperationalDefinitions) {
      expect(definition.implementation).toBe('planned');
      expect(definition.feeds.every((feed) => feed.implementation === 'planned')).toBe(true);
      expect(definition.layers.every((layer) => layer.implementation === 'planned')).toBe(true);
      expect(
        seedRegistry.providers.find((provider) => provider.id === definition.id)
      ).toMatchObject({
        mode: 'unavailable',
        health: 'unavailable',
      });
      expect(
        liveRegistry.providers.find((provider) => provider.id === definition.id)
      ).toMatchObject({
        mode: 'unavailable',
        health: 'unavailable',
      });

      const access = definition.source_access;
      expect(access.evidence_reviewed_on).toBe('2026-09-05');
      expect(access.products.length).toBeGreaterThan(0);
      expect(access.products.every((product) => product.endpoints.length > 0)).toBe(true);
      expect(access.products.every((product) => product.formats.length > 0)).toBe(true);
      expect(access.approval.terms_url).toMatch(/^https:\/\//);
      expect(access.approval.attribution_url).toMatch(/^https:\/\//);
      expect(access.operations.refresh_seconds).toBeGreaterThan(0);
      expect(access.operations.timeout_ms).toBeGreaterThan(0);
      expect(access.operations.max_response_bytes).toBeGreaterThan(0);
      expect(access.operations.max_concurrency).toBeGreaterThan(0);
      expect(access.operations.kill_switch).toMatch(/^GEV_[A-Z0-9_]+_ENABLED$/);
      expect(killSwitches.has(access.operations.kill_switch)).toBe(false);
      killSwitches.add(access.operations.kill_switch);

      for (const layer of definition.layers) {
        const documentationPath = fileURLToPath(
          new URL(`../../../${layer.documentation_path}`, import.meta.url)
        );
        expect(fs.existsSync(documentationPath), layer.documentation_path).toBe(true);
      }
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(nowSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    nowSpy.mockRestore();
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
