import {
  type ProviderHealth,
  type ProviderImplementationState,
  type ProviderRegistry,
  type ProviderRegistryCounts,
  ProviderRegistryCountsSchema,
  type ProviderRegistryFeed,
  type ProviderRegistryFeedView,
  ProviderRegistryFeedViewSchema,
  type ProviderRegistryLayer,
  type ProviderRegistryProvider,
  ProviderRegistrySchema,
  type ProviderRequestedMode,
  type ProviderRuntimeMode,
  type ProviderSource,
} from '@gev/contracts';

type SupportedProviderMode = Exclude<ProviderRuntimeMode, 'unavailable'>;

interface ProviderDefinition {
  id: string;
  name: string;
  source: ProviderSource;
  implementation: ProviderImplementationState;
  supported_modes: SupportedProviderMode[];
  feeds: ProviderRegistryFeed[];
  layers: ProviderRegistryLayer[];
}

export interface CreateProviderRegistryOptions {
  requestedMode?: ProviderRequestedMode;
  disabledProviderIds?: Iterable<string>;
}

const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  {
    id: 'opensky',
    name: 'OpenSky Network',
    source: {
      name: 'OpenSky Network',
      url: 'https://opensky-network.org/',
      license: 'OpenSky Network terms of use',
      attribution: 'The OpenSky Network',
    },
    implementation: 'implemented',
    supported_modes: ['seed', 'live'],
    feeds: [{ id: 'flights', name: 'Aircraft state vectors', implementation: 'implemented' }],
    layers: [
      {
        id: 'flights',
        name: 'ADS-B aviation',
        implementation: 'implemented',
        documentation_path: 'docs/data-sources/flights.md',
      },
    ],
  },
  {
    id: 'aisstream',
    name: 'AISStream',
    source: {
      name: 'AISStream',
      url: 'https://aisstream.io/',
      license: 'AISStream developer API terms',
      attribution: 'AISStream',
    },
    implementation: 'implemented',
    supported_modes: ['seed', 'live'],
    feeds: [{ id: 'ships', name: 'AIS vessel telemetry', implementation: 'implemented' }],
    layers: [
      {
        id: 'marine',
        name: 'AIS maritime',
        implementation: 'implemented',
        documentation_path: 'docs/data-sources/ships.md',
      },
    ],
  },
  {
    id: 'celestrak',
    name: 'CelesTrak',
    source: {
      name: 'CelesTrak',
      url: 'https://celestrak.org/',
      license: 'Source terms pending task 5.2.3 and OQ-7',
      attribution: 'CelesTrak (planned source)',
    },
    implementation: 'planned',
    supported_modes: [],
    feeds: [{ id: 'satellites', name: 'Orbital elements', implementation: 'planned' }],
    layers: [
      {
        id: 'satellites',
        name: 'Satellite tracks',
        implementation: 'planned',
        documentation_path: 'docs/data-sources/satellites.md',
      },
    ],
  },
  {
    id: 'usgs',
    name: 'U.S. Geological Survey',
    source: {
      name: 'USGS Earthquake Hazards Program',
      url: 'https://earthquake.usgs.gov/',
      license: 'U.S. government public-domain data; source terms apply',
      attribution: 'U.S. Geological Survey',
    },
    implementation: 'implemented',
    supported_modes: ['seed', 'live'],
    feeds: [{ id: 'quakes', name: 'Earthquake events', implementation: 'implemented' }],
    layers: [
      {
        id: 'quakes',
        name: 'Earthquakes',
        implementation: 'implemented',
        documentation_path: 'docs/data-sources/quakes.md',
      },
    ],
  },
  {
    id: 'nasa-firms',
    name: 'NASA FIRMS',
    source: {
      name: 'NASA Fire Information for Resource Management System',
      url: 'https://firms.modaps.eosdis.nasa.gov/',
      license: 'NASA Earthdata and FIRMS source terms',
      attribution: 'NASA LANCE / FIRMS MODIS and VIIRS',
    },
    implementation: 'implemented',
    supported_modes: ['seed', 'live'],
    feeds: [{ id: 'firms', name: 'Thermal hotspots', implementation: 'implemented' }],
    layers: [
      {
        id: 'firms',
        name: 'Wildfires and thermal hotspots',
        implementation: 'implemented',
        documentation_path: 'docs/data-sources/fires.md',
      },
    ],
  },
  {
    id: 'dot-traffic',
    name: 'Public traffic camera catalogs',
    source: {
      name: 'State and municipal transportation agencies',
      url: 'https://www.transportation.gov/',
      license: 'Source-specific public-feed terms',
      attribution: 'Source transportation agency',
    },
    implementation: 'implemented',
    supported_modes: ['seed'],
    feeds: [{ id: 'cctv', name: 'Traffic camera catalog', implementation: 'implemented' }],
    layers: [
      {
        id: 'cctv',
        name: 'Public traffic cameras',
        implementation: 'implemented',
        documentation_path: 'docs/data-sources/cctv.md',
      },
    ],
  },
  {
    id: 'radio-browser',
    name: 'Radio Browser',
    source: {
      name: 'Radio Browser',
      url: 'https://www.radio-browser.info/',
      license: 'Radio Browser API terms; individual stream rights remain source-specific',
      attribution: 'Radio Browser and originating stream operators',
    },
    implementation: 'implemented',
    supported_modes: ['seed'],
    feeds: [{ id: 'radio', name: 'Radio station catalog', implementation: 'implemented' }],
    layers: [
      {
        id: 'radio',
        name: 'Radio and ATC stations',
        implementation: 'implemented',
        documentation_path: 'docs/data-sources/radio.md',
      },
    ],
  },
  {
    id: 'launch-replays',
    name: 'Launch trajectory seed replays',
    source: {
      name: 'Reconstructed public launch telemetry',
      url: 'https://thespacedevs.com/llapi',
      license: 'Reconstructed seed fixture; upstream source terms apply',
      attribution: 'The Space Devs and public launch telemetry sources',
    },
    implementation: 'implemented',
    supported_modes: ['seed'],
    feeds: [{ id: 'launches', name: 'Launch mission replays', implementation: 'implemented' }],
    layers: [
      {
        id: 'launches',
        name: 'Launch trajectories',
        implementation: 'implemented',
        documentation_path: 'docs/data-sources/launches.md',
      },
    ],
  },
  {
    id: 'rainviewer',
    name: 'RainViewer',
    source: {
      name: 'RainViewer',
      url: 'https://www.rainviewer.com/',
      license: 'RainViewer API terms; NOAA observations retain source terms',
      attribution: 'RainViewer and source weather agencies',
    },
    implementation: 'implemented',
    supported_modes: ['seed'],
    feeds: [{ id: 'weather', name: 'Weather and radar seed data', implementation: 'implemented' }],
    layers: [
      {
        id: 'weather',
        name: 'Weather and radar',
        implementation: 'implemented',
        documentation_path: 'docs/data-sources/weather.md',
      },
    ],
  },
  {
    id: 'gbfs',
    name: 'General Bikeshare Feed Specification',
    source: {
      name: 'Regional GBFS operators',
      url: 'https://gbfs.org/',
      license: 'Source-specific open-data terms',
      attribution: 'Originating GBFS system operator',
    },
    implementation: 'implemented',
    supported_modes: ['seed', 'live'],
    feeds: [{ id: 'gbfs', name: 'Bikeshare station status', implementation: 'implemented' }],
    layers: [
      {
        id: 'gbfs',
        name: 'Bikeshare stations',
        implementation: 'implemented',
        documentation_path: 'docs/data-sources/gbfs.md',
      },
    ],
  },
  {
    id: 'overpass-api',
    name: 'OpenStreetMap Overpass API',
    source: {
      name: 'OpenStreetMap',
      url: 'https://www.openstreetmap.org/',
      license: 'Open Database License 1.0; output obligations depend on use',
      attribution: 'OpenStreetMap contributors',
    },
    implementation: 'implemented',
    supported_modes: ['seed', 'live'],
    feeds: [{ id: 'overpass', name: 'Sanitized OSM queries', implementation: 'implemented' }],
    layers: [
      {
        id: 'overpass',
        name: 'OpenStreetMap query results',
        implementation: 'incomplete',
        documentation_path: 'docs/data-sources/overpass.md',
      },
    ],
  },
  {
    id: 'telegeography-cables',
    name: 'TeleGeography submarine cables',
    source: {
      name: 'TeleGeography Submarine Cable Map',
      url: 'https://www.submarinecablemap.com/',
      license: 'CC BY-NC-SA 4.0 optional download pack; redistribution review required',
      attribution: 'TeleGeography',
    },
    implementation: 'incomplete',
    supported_modes: ['download_pack'],
    feeds: [{ id: 'cables', name: 'Submarine cable catalog', implementation: 'incomplete' }],
    layers: [
      {
        id: 'cables',
        name: 'Submarine cables',
        implementation: 'incomplete',
        documentation_path: 'docs/data-sources/cables.md',
      },
    ],
  },
];

function resolveProviderState(
  definition: ProviderDefinition,
  requestedMode: ProviderRequestedMode,
  disabledProviderIds: ReadonlySet<string>
): { mode: ProviderRuntimeMode; health: ProviderHealth } {
  if (definition.implementation === 'planned') {
    return { mode: 'unavailable', health: 'unavailable' };
  }

  if (definition.implementation === 'incomplete') {
    return {
      mode: definition.supported_modes.includes('download_pack') ? 'download_pack' : 'unavailable',
      health: 'unavailable',
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

  return ProviderRegistrySchema.parse({
    version: 1,
    requested_mode: requestedMode,
    providers: PROVIDER_DEFINITIONS.map((definition): ProviderRegistryProvider => {
      const state = resolveProviderState(definition, requestedMode, disabledProviderIds);
      return {
        ...definition,
        ...state,
      };
    }),
  });
}

export function createConfiguredProviderRegistry(
  environment: Readonly<Record<string, string | undefined>> = process.env
): ProviderRegistry {
  return createProviderRegistry({ requestedMode: resolveProviderRequestedMode(environment) });
}

export function summarizeProviderRegistry(registry: ProviderRegistry): ProviderRegistryCounts {
  const providers = registry.providers;
  const activeProviders = providers.filter(
    (provider) => provider.implementation === 'implemented' && provider.health !== 'unavailable'
  );
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
        ({ provider, feed }) =>
          provider.health !== 'unavailable' && feed.implementation === 'implemented'
      ).length,
    },
    layers: {
      total: layers.length,
      active: layers.filter(
        ({ provider, layer }) =>
          provider.health !== 'unavailable' && layer.implementation === 'implemented'
      ).length,
    },
  });
}

export function listProviderRegistryFeeds(registry: ProviderRegistry): ProviderRegistryFeedView[] {
  return registry.providers.flatMap((provider) =>
    provider.feeds.map((feed) =>
      ProviderRegistryFeedViewSchema.parse({
        id: feed.id,
        name: feed.name,
        provider: provider.id,
        provider_name: provider.name,
        implementation: feed.implementation,
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

export function renderProviderRegistryMarkdown(registry: ProviderRegistry): string {
  const counts = summarizeProviderRegistry(registry);
  const lines = [
    '# Generated Provider Registry',
    '',
    '<!-- Generated by `pnpm docs:providers` from packages/providers/src/registry.ts. -->',
    '',
    `Registry version ${registry.version}; requested mode \`${registry.requested_mode}\`.`,
    '',
    `Active/registered: ${counts.providers.active}/${counts.providers.total} providers, ${counts.feeds.active}/${counts.feeds.total} feeds, ${counts.layers.active}/${counts.layers.total} layers.`,
    '',
    '| Provider | Feed | Layer | Source | License / terms | Attribution | Provider state | Feed state | Layer state | Mode | Health | Documentation |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];

  for (const provider of registry.providers) {
    const feed = provider.feeds[0];
    const layer = provider.layers[0];
    if (!feed || !layer) {
      continue;
    }
    const docsLink = `../${layer.documentation_path.replace(/^docs\//, '')}`;
    lines.push(
      `| \`${provider.id}\` | \`${feed.id}\` | \`${layer.id}\` | [${provider.source.name}](${provider.source.url}) | ${provider.source.license} | ${provider.source.attribution} | ${provider.implementation} | ${feed.implementation} | ${layer.implementation} | ${provider.mode} | ${provider.health} | [${layer.name}](${docsLink}) |`
    );
  }

  lines.push(
    '',
    'Entries marked `planned`, `incomplete`, `download_pack`, or `unavailable` are registered for truthful discovery and are not counted as active.',
    '',
    'License and attribution details are source-specific; see each linked data-source document before enabling live or redistributed data.',
    ''
  );

  return lines.join('\n');
}
