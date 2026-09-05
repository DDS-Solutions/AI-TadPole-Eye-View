import type {
  ProviderImplementationState,
  ProviderRegistryFeed,
  ProviderRegistryLayer,
  ProviderRuntimeMode,
  ProviderSource,
} from '@gev/contracts';
import { OPERATIONAL_AWARENESS_PROVIDER_DEFINITIONS } from './operationalRegistryDefinitions.js';
import type { OperationalAccessDecision } from './operationalRegistryDefinitions.js';
import { OPERATIONAL_IMAGERY_PROVIDER_DEFINITIONS } from './operationalRegistryDefinitionsImagery.js';

type SupportedProviderMode = Exclude<ProviderRuntimeMode, 'unavailable'>;

export interface ProviderDefinition {
  id: string;
  name: string;
  source: ProviderSource;
  mode_sources?: Partial<Record<SupportedProviderMode, ProviderSource>>;
  implementation: ProviderImplementationState;
  source_access?: OperationalAccessDecision;
  supported_modes: SupportedProviderMode[];
  feeds: ProviderRegistryFeed[];
  layers: ProviderRegistryLayer[];
}

export function resolveProviderDefinitionSource(
  definition: ProviderDefinition,
  mode: ProviderRuntimeMode
): ProviderSource {
  return mode === 'unavailable'
    ? definition.source
    : (definition.mode_sources?.[mode] ?? definition.source);
}

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
      name: 'CelesTrak standard GP (JSON/OMM)',
      url: 'https://celestrak.org/NORAD/documentation/gp-data-formats.php',
      license_id: 'celestrak-usage-guidelines-commercial-confirmation-required',
      license:
        'CelesTrak usage guidelines; production requires recorded commercial-use confirmation or owner acceptance',
      attribution:
        'Orbital elements: CelesTrak; Basic SSA data: U.S. Space Force / 18 SDS via Space-Track.org; positions are GEV-derived estimates',
    },
    mode_sources: {
      seed: {
        name: 'GEV synthetic satellite fixture',
        url: 'https://github.com/DDS-Solutions/AI-TadPole-Eye-View',
        license_id: 'gev-synthetic-fixture-mit',
        license: 'MIT synthetic fixture generated for GEV',
        attribution: 'GEV synthetic orbital elements; no real catalog records',
      },
    },
    implementation: 'implemented',
    supported_modes: ['seed', 'live'],
    feeds: [
      {
        id: 'satellites',
        name: 'Orbital elements',
        implementation: 'implemented',
        freshness: definedFreshness(7_200),
      },
    ],
    layers: [
      {
        id: 'satellites',
        name: 'Satellite tracks',
        implementation: 'implemented',
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
    id: 'submarine-cables',
    name: 'Submarine cable catalog',
    source: {
      name: 'GEV procedural synthetic cable fixture',
      url: 'https://github.com/DDS-Solutions/AI-TadPole-Eye-View/tree/main/fixtures',
      license_id: 'gev-synthetic-fixture-mit',
      license: 'MIT-licensed procedural synthetic fixture',
      attribution: 'DDS-Solutions GEV synthetic fixture',
    },
    mode_sources: {
      download_pack: {
        name: 'TeleGeography licensed map data',
        url: 'https://www2.telegeography.com/license-geocoded-map-data',
        license_id: 'telegeography-commercial-data-license',
        license: 'Operator-specific annual TeleGeography map-data license required',
        attribution: 'TeleGeography',
      },
    },
    implementation: 'implemented',
    supported_modes: ['seed', 'download_pack'],
    feeds: [
      {
        id: 'cables',
        name: 'Submarine cable catalog',
        implementation: 'implemented',
        freshness: definedFreshness(86_400),
      },
    ],
    layers: [
      {
        id: 'cables',
        name: 'Submarine cables',
        implementation: 'implemented',
        documentation_path: 'docs/data-sources/cables.md',
      },
    ],
  },
  ...OPERATIONAL_AWARENESS_PROVIDER_DEFINITIONS,
  ...OPERATIONAL_IMAGERY_PROVIDER_DEFINITIONS,
];
