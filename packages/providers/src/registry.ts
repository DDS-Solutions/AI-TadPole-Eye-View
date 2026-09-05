import {
  type ProviderHealth,
  type ProviderRegistry,
  type ProviderRegistryCounts,
  ProviderRegistryCountsSchema,
  type ProviderRegistryFeedView,
  ProviderRegistryFeedViewSchema,
  type ProviderRegistryProvider,
  ProviderRegistrySchema,
  type ProviderRequestedMode,
  type ProviderRuntimeMode,
} from '@gev/contracts';
import {
  PROVIDER_DEFINITIONS,
  type ProviderDefinition,
  resolveProviderDefinitionSource,
} from './registryDefinitions.js';

export interface CreateProviderRegistryOptions {
  requestedMode?: ProviderRequestedMode;
  disabledProviderIds?: Iterable<string>;
  unavailableProviderIds?: Iterable<string>;
  activeDownloadPackProviderIds?: Iterable<string>;
}

export interface RenderProviderRegistryMarkdownOptions {
  headingLevel?: 2 | 3;
  documentationHref?: (documentationPath: string) => string;
}

function resolveProviderState(
  definition: ProviderDefinition,
  requestedMode: ProviderRequestedMode,
  disabledProviderIds: ReadonlySet<string>,
  unavailableProviderIds: ReadonlySet<string>,
  activeDownloadPackProviderIds: ReadonlySet<string>
): { mode: ProviderRuntimeMode; health: ProviderHealth } {
  if (definition.implementation === 'planned') {
    return { mode: 'unavailable', health: 'unavailable' };
  }

  if (definition.implementation === 'incomplete') {
    return { mode: 'unavailable', health: 'unavailable' };
  }

  if (unavailableProviderIds.has(definition.id)) {
    return { mode: 'unavailable', health: 'unavailable' };
  }

  if (activeDownloadPackProviderIds.has(definition.id)) {
    if (!definition.supported_modes.includes('download_pack')) {
      throw new Error(`Provider '${definition.id}' does not support download-pack mode`);
    }
    return {
      mode: 'download_pack',
      health: disabledProviderIds.has(definition.id) ? 'degraded' : 'healthy',
    };
  }

  if (!definition.supported_modes.includes(requestedMode)) {
    return { mode: 'unavailable', health: 'unavailable' };
  }

  return {
    mode: requestedMode,
    health: disabledProviderIds.has(definition.id) ? 'degraded' : 'healthy',
  };
}

export function resolveProviderRequestedMode(
  environment: Readonly<Record<string, string | undefined>> = process.env
): ProviderRequestedMode {
  return environment.GEV_LIVE_MODE === '1' && environment.GEV_SEED_MODE !== '1' ? 'live' : 'seed';
}

export function createProviderRegistry(
  options: CreateProviderRegistryOptions = {}
): ProviderRegistry {
  const requestedMode = options.requestedMode ?? 'seed';
  const disabledProviderIds = new Set(options.disabledProviderIds ?? []);
  const unavailableProviderIds = new Set(options.unavailableProviderIds ?? []);
  const activeDownloadPackProviderIds = new Set(options.activeDownloadPackProviderIds ?? []);

  return ProviderRegistrySchema.parse({
    version: 2,
    requested_mode: requestedMode,
    providers: PROVIDER_DEFINITIONS.map((definition): ProviderRegistryProvider => {
      const state = resolveProviderState(
        definition,
        requestedMode,
        disabledProviderIds,
        unavailableProviderIds,
        activeDownloadPackProviderIds
      );
      return {
        ...definition,
        source: resolveProviderDefinitionSource(definition, state.mode),
        ...state,
      };
    }),
  });
}

export function createConfiguredProviderRegistry(
  environment: Readonly<Record<string, string | undefined>> = process.env
): ProviderRegistry {
  const requestedMode = resolveProviderRequestedMode(environment);
  const disabledProviderIds: string[] = [];
  if (environment.GEV_CABLES_ENABLED === '0') disabledProviderIds.push('submarine-cables');
  if (environment.GEV_SATELLITES_ENABLED === '0') disabledProviderIds.push('celestrak');

  const satelliteLiveLocked =
    requestedMode === 'live' &&
    (environment.GEV_SATELLITES_LIVE_ACCESS !== '1' ||
      environment.GEV_CELESTRAK_TERMS_APPROVED !== '1');
  return createProviderRegistry({
    requestedMode,
    disabledProviderIds,
    unavailableProviderIds: satelliteLiveLocked ? ['celestrak'] : [],
  });
}

export function activateProviderDownloadPack(
  registry: ProviderRegistry,
  providerId: string
): ProviderRegistry {
  const definition = PROVIDER_DEFINITIONS.find((candidate) => candidate.id === providerId);
  const current = registry.providers.find((provider) => provider.id === providerId);
  if (!definition || !current || definition.implementation !== 'implemented') {
    throw new Error(`Provider '${providerId}' is not implemented`);
  }
  if (!definition.supported_modes.includes('download_pack')) {
    throw new Error(`Provider '${providerId}' does not support download-pack mode`);
  }
  if (current.health !== 'healthy') {
    throw new Error(`Provider '${providerId}' is not healthy enough to activate a pack`);
  }

  return ProviderRegistrySchema.parse({
    ...registry,
    providers: registry.providers.map((provider) =>
      provider.id === providerId
        ? {
            ...provider,
            source: resolveProviderDefinitionSource(definition, 'download_pack'),
            mode: 'download_pack',
            health: 'healthy',
          }
        : provider
    ),
  });
}

export function summarizeProviderRegistry(registry: ProviderRegistry): ProviderRegistryCounts {
  const providers = registry.providers;
  const activeProviders = providers.filter(isActiveProvider);
  const feeds = providers.flatMap((provider) => provider.feeds.map((feed) => ({ provider, feed })));
  const layers = providers.flatMap((provider) =>
    provider.layers.map((layer) => ({ provider, layer }))
  );

  return ProviderRegistryCountsSchema.parse({
    providers: {
      total: providers.length,
      active: activeProviders.length,
    },
    feeds: {
      total: feeds.length,
      active: feeds.filter(
        ({ provider, feed }) => isActiveProvider(provider) && feed.implementation === 'implemented'
      ).length,
    },
    layers: {
      total: layers.length,
      active: layers.filter(
        ({ provider, layer }) =>
          isActiveProvider(provider) && layer.implementation === 'implemented'
      ).length,
    },
  });
}

function isActiveProvider(provider: ProviderRegistryProvider): boolean {
  return (
    provider.implementation === 'implemented' &&
    (provider.mode === 'seed' || provider.mode === 'live') &&
    provider.health === 'healthy'
  );
}

export function listProviderRegistryFeeds(registry: ProviderRegistry): ProviderRegistryFeedView[] {
  return registry.providers.flatMap((provider) =>
    provider.feeds.map((feed) =>
      ProviderRegistryFeedViewSchema.parse({
        id: feed.id,
        name: feed.name,
        provider: provider.id,
        provider_name: provider.name,
        source: provider.source,
        implementation: feed.implementation,
        freshness: feed.freshness,
        mode: provider.mode,
        status: feed.implementation === 'implemented' ? provider.health : 'unavailable',
        layer_ids: provider.layers.map((layer) => layer.id),
      })
    )
  );
}

export function withDisabledProviders(
  registry: ProviderRegistry,
  disabledProviderIds: Iterable<string>
): ProviderRegistry {
  const disabled = new Set(disabledProviderIds);
  return ProviderRegistrySchema.parse({
    ...registry,
    providers: registry.providers.map((provider) => ({
      ...provider,
      health:
        disabled.has(provider.id) && provider.health === 'healthy'
          ? ('degraded' as const)
          : provider.health,
    })),
  });
}

export function withUnavailableProviders(
  registry: ProviderRegistry,
  unavailableProviderIds: Iterable<string>
): ProviderRegistry {
  const unavailable = new Set(unavailableProviderIds);
  return ProviderRegistrySchema.parse({
    ...registry,
    providers: registry.providers.map((provider) =>
      unavailable.has(provider.id)
        ? { ...provider, mode: 'unavailable' as const, health: 'unavailable' as const }
        : provider
    ),
  });
}

export function withProviderHealth(
  registry: ProviderRegistry,
  providerId: string,
  health: ProviderHealth
): ProviderRegistry {
  if (!registry.providers.some((provider) => provider.id === providerId)) {
    throw new Error(`Unknown provider '${providerId}'`);
  }
  return ProviderRegistrySchema.parse({
    ...registry,
    providers: registry.providers.map((provider) =>
      provider.id === providerId ? { ...provider, health } : provider
    ),
  });
}

function escapeMarkdownText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function renderFreshness(provider: ProviderRegistryProvider, feedIndex: number): string {
  const feed = provider.feeds[feedIndex];
  if (!feed) {
    throw new Error(`Provider '${provider.id}' is missing feed index ${feedIndex}`);
  }
  return feed.freshness.status === 'defined'
    ? `${feed.freshness.fresh_for_seconds}s`
    : `unavailable: ${escapeMarkdownText(feed.freshness.reason)}`;
}

export function renderProviderRegistryMarkdown(
  registry: ProviderRegistry,
  options: RenderProviderRegistryMarkdownOptions = {}
): string {
  const counts = summarizeProviderRegistry(registry);
  const headingLevel = options.headingLevel ?? 2;
  const subheading = '#'.repeat(headingLevel);
  const documentationHref =
    options.documentationHref ??
    ((documentationPath: string) => `../${documentationPath.replace(/^docs\//, '')}`);
  const lines = [
    `${subheading} Registry snapshot`,
    '',
    `Registry version ${registry.version}; requested mode \`${registry.requested_mode}\`.`,
    '',
    '| Entity | Registered | Active |',
    '|---|---:|---:|',
    `| Providers | ${counts.providers.total} | ${counts.providers.active} |`,
    `| Feeds | ${counts.feeds.total} | ${counts.feeds.active} |`,
    `| Layers | ${counts.layers.total} | ${counts.layers.active} |`,
    '',
    `${subheading}# Providers`,
    '',
    '| Provider | Name | Active | Implementation | Requested mode | Runtime mode | Health | Source | License ID | License / terms | Attribution |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];

  for (const provider of registry.providers) {
    lines.push(
      `| \`${provider.id}\` | ${escapeMarkdownText(provider.name)} | ${isActiveProvider(provider) ? 'yes' : 'no'} | \`${provider.implementation}\` | \`${registry.requested_mode}\` | \`${provider.mode}\` | \`${provider.health}\` | [${escapeMarkdownText(provider.source.name)}](${provider.source.url}) | \`${provider.source.license_id}\` | ${escapeMarkdownText(provider.source.license)} | ${escapeMarkdownText(provider.source.attribution)} |`
    );
  }

  lines.push(
    '',
    `${subheading}# Feeds`,
    '',
    '| Feed | Name | Provider | Active | Implementation | Requested mode | Runtime mode | Health | Freshness |',
    '|---|---|---|---|---|---|---|---|---|'
  );
  for (const provider of registry.providers) {
    for (const [feedIndex, feed] of provider.feeds.entries()) {
      const active = isActiveProvider(provider) && feed.implementation === 'implemented';
      lines.push(
        `| \`${feed.id}\` | ${escapeMarkdownText(feed.name)} | \`${provider.id}\` | ${active ? 'yes' : 'no'} | \`${feed.implementation}\` | \`${registry.requested_mode}\` | \`${provider.mode}\` | \`${provider.health}\` | ${renderFreshness(provider, feedIndex)} |`
      );
    }
  }

  lines.push(
    '',
    `${subheading}# Layers`,
    '',
    '| Layer | Name | Provider | Active | Implementation | Requested mode | Runtime mode | Health | Documentation |',
    '|---|---|---|---|---|---|---|---|---|'
  );
  for (const provider of registry.providers) {
    for (const layer of provider.layers) {
      const docsLink = documentationHref(layer.documentation_path);
      if (docsLink.trim() === '') {
        throw new Error(`Layer '${layer.id}' produced an empty documentation link`);
      }
      const active = isActiveProvider(provider) && layer.implementation === 'implemented';
      lines.push(
        `| \`${layer.id}\` | ${escapeMarkdownText(layer.name)} | \`${provider.id}\` | ${active ? 'yes' : 'no'} | \`${layer.implementation}\` | \`${registry.requested_mode}\` | \`${provider.mode}\` | \`${provider.health}\` | [${escapeMarkdownText(layer.name)}](${docsLink}) |`
      );
    }
  }

  lines.push(
    '',
    'Active counts require an implemented entry on a healthy provider running in `seed` or `live` mode. Planned, incomplete, disabled, download-pack, degraded, and unavailable entries remain registered but are not counted as active.',
    '',
    'Implemented provider responses carry DataProvenance schema version 1. Freshness is observation age evaluated against the registry threshold; cache retention is a separate server policy.',
    '',
    'License and attribution details are source-specific; see each linked data-source document before enabling live or redistributed data.',
    ''
  );

  return lines.join('\n');
}
