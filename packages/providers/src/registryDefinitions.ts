import type {
  ProviderImplementationState,
  ProviderRegistryFeed,
  ProviderRegistryLayer,
  ProviderRuntimeMode,
  ProviderSource,
} from '@gev/contracts';

type SupportedProviderMode = Exclude<ProviderRuntimeMode, 'unavailable'>;

export interface ProviderDefinition {
  id: string;
  name: string;
  source: ProviderSource;
  implementation: ProviderImplementationState;
  supported_modes: SupportedProviderMode[];
  feeds: ProviderRegistryFeed[];
  layers: ProviderRegistryLayer[];
}

const unavailableFreshness = (reason: string) => ({ status: 'unavailable' as const, reason });
const definedFreshness = (freshForSeconds: number) => ({
  status: 'defined' as const,
  fresh_for_seconds: freshForSeconds,
});

export const PROVIDER_DEFINITIONS: readonly ProviderDefinition[] = [
  {
    id: 'opensky',
    name: 'OpenSky Network',
    source: {
      name: 'OpenSky Network',
      url: 'https://opensky-network.org/',
      license_id: 'opensky-terms-of-use',
      license: 'OpenSky Network terms of use',
      attribution: 'The OpenSky Network',
    },
    implementation: 'implemented',
    supported_modes: ['seed', 'live'],
    feeds: [
      {
        id: 'flights',
        name: 'Aircraft state vectors',
        implementation: 'implemented',
        freshness: definedFreshness(5),
      },
    ],
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
      license_id: 'aisstream-developer-api-terms',
      license: 'AISStream developer API terms',
      attribution: 'AISStream',
    },
    implementation: 'implemented',
    supported_modes: ['seed', 'live'],
    feeds: [
      {
        id: 'ships',
        name: 'AIS vessel telemetry',
        implementation: 'implemented',
        freshness: definedFreshness(15),
      },
    ],
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
      license_id: 'pending-task-5-2-3',
      license: 'Source terms pending task 5.2.3 and OQ-7',
      attribution: 'CelesTrak (planned source)',
    },
    implementation: 'planned',
    supported_modes: [],
    feeds: [
      {
        id: 'satellites',
        name: 'Orbital elements',
        implementation: 'planned',
        freshness: unavailableFreshness('Freshness policy is deferred to task 5.2.3'),
      },
    ],
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
      license_id: 'us-government-public-domain',
      license: 'U.S. government public-domain data; source terms apply',
      attribution: 'U.S. Geological Survey',
    },
    implementation: 'implemented',
    supported_modes: ['seed', 'live'],
    feeds: [
      {
        id: 'quakes',
        name: 'Earthquake events',
        implementation: 'implemented',
        freshness: definedFreshness(60),
      },
    ],
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
      license_id: 'nasa-earthdata-firms-terms',
      license: 'NASA Earthdata and FIRMS source terms',
      attribution: 'NASA LANCE / FIRMS MODIS and VIIRS',
    },
    implementation: 'implemented',
    supported_modes: ['seed', 'live'],
    feeds: [
      {
        id: 'firms',
        name: 'Thermal hotspots',
        implementation: 'implemented',
        freshness: definedFreshness(300),
      },
    ],
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
      license_id: 'source-specific-public-feed-terms',
      license: 'Source-specific public-feed terms',
      attribution: 'Source transportation agency',
    },
    implementation: 'implemented',
    supported_modes: ['seed'],
    feeds: [
      {
        id: 'cctv',
        name: 'Traffic camera catalog',
        implementation: 'implemented',
        freshness: definedFreshness(10),
      },
    ],
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
      license_id: 'radio-browser-api-stream-terms',
      license: 'Radio Browser API terms; individual stream rights remain source-specific',
      attribution: 'Radio Browser and originating stream operators',
    },
    implementation: 'implemented',
    supported_modes: ['seed'],
    feeds: [
      {
        id: 'radio',
        name: 'Radio station catalog',
        implementation: 'implemented',
        freshness: definedFreshness(60),
      },
    ],
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
      license_id: 'reconstructed-seed-upstream-terms',
      license: 'Reconstructed seed fixture; upstream source terms apply',
      attribution: 'The Space Devs and public launch telemetry sources',
    },
    implementation: 'implemented',
    supported_modes: ['seed'],
    feeds: [
      {
        id: 'launches',
        name: 'Launch mission replays',
        implementation: 'implemented',
        freshness: definedFreshness(600),
      },
    ],
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
      license_id: 'rainviewer-api-source-agency-terms',
      license: 'RainViewer API terms; NOAA observations retain source terms',
      attribution: 'RainViewer and source weather agencies',
    },
    implementation: 'implemented',
    supported_modes: ['seed'],
    feeds: [
      {
        id: 'weather',
        name: 'Weather and radar seed data',
        implementation: 'implemented',
        freshness: definedFreshness(300),
      },
    ],
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
      license_id: 'source-specific-open-data-terms',
      license: 'Source-specific open-data terms',
      attribution: 'Originating GBFS system operator',
    },
    implementation: 'implemented',
    supported_modes: ['seed', 'live'],
    feeds: [
      {
        id: 'gbfs',
        name: 'Bikeshare station status',
        implementation: 'implemented',
        freshness: definedFreshness(30),
      },
    ],
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
      license_id: 'odbl-1-0',
      license: 'Open Database License 1.0; output obligations depend on use',
      attribution: 'OpenStreetMap contributors',
    },
    implementation: 'implemented',
    supported_modes: ['seed', 'live'],
    feeds: [
      {
        id: 'overpass',
        name: 'Sanitized OSM queries',
        implementation: 'implemented',
        freshness: definedFreshness(30),
      },
    ],
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
      license_id: 'cc-by-nc-sa-4-0',
      license: 'CC BY-NC-SA 4.0 optional download pack; redistribution review required',
      attribution: 'TeleGeography',
    },
    implementation: 'incomplete',
    supported_modes: ['download_pack'],
    feeds: [
      {
        id: 'cables',
        name: 'Submarine cable catalog',
        implementation: 'incomplete',
        freshness: unavailableFreshness('Freshness policy is deferred to task 5.2.2'),
      },
    ],
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
