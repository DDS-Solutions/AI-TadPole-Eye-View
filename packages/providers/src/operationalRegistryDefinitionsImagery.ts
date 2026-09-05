import {
  type PlannedOperationalProviderDefinition,
  allLiveEnvironments,
  noFreshness,
  noScopes,
} from './operationalRegistryDefinitions.js';

export const OPERATIONAL_IMAGERY_PROVIDER_DEFINITIONS = [
  {
    id: 'noaa-coops',
    name: 'NOAA CO-OPS',
    source: {
      name: 'NOAA CO-OPS Data and Metadata APIs',
      url: 'https://tidesandcurrents.noaa.gov/web_services_info.html',
      license_id: 'us-government-public-domain',
      license: 'NOAA public-domain notice; CO-OPS raw-data and prediction disclaimers apply',
      attribution: 'NOAA / National Ocean Service / CO-OPS',
    },
    implementation: 'planned',
    supported_modes: ['seed', 'live'],
    feeds: [
      {
        id: 'coastal-water-levels',
        name: 'CO-OPS water-level observations and tide predictions',
        implementation: 'planned',
        freshness: noFreshness(
          'Planned observation and prediction source has no implemented evaluation'
        ),
      },
      {
        id: 'coastal-currents',
        name: 'CO-OPS current observations and predictions',
        implementation: 'planned',
        freshness: noFreshness(
          'Planned observation and prediction source has no implemented evaluation'
        ),
      },
    ],
    layers: [
      {
        id: 'coastal-conditions',
        name: 'Coastal water levels, tides, and currents',
        implementation: 'planned',
        documentation_path: 'docs/data-sources/coastal-conditions.md',
      },
    ],
    source_access: {
      evidence_reviewed_on: '2026-09-05',
      decision_rank: 5,
      products: [
        {
          id: 'coops-data-api',
          name: 'Water level, predictions, currents, and current predictions',
          transport: 'https',
          endpoints: ['https://api.tidesandcurrents.noaa.gov/api/prod/datagetter'],
          formats: ['JSON'],
          coverage: 'Active NOAA CO-OPS stations on U.S. coasts, territories, and Great Lakes',
          time_semantics:
            'Observation, prediction, datum, units, and requested time zone are retained explicitly',
        },
        {
          id: 'coops-metadata-api',
          name: 'CO-OPS station and datum metadata',
          transport: 'https',
          endpoints: ['https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json'],
          formats: ['JSON'],
          coverage: 'NOAA CO-OPS station inventory',
          time_semantics: 'Station metadata retrieval time and source update are not observations',
        },
      ],
      credential: {
        kind: 'application_identifier',
        setup_url: 'https://api.tidesandcurrents.noaa.gov/api/prod/',
        required_scopes: noScopes,
        validation_method:
          'A fixed non-secret application identifier is required on every data request',
      },
      approval: {
        owner: 'gev-data-licensing-owner',
        status: 'record_required',
        terms_url: 'https://tidesandcurrents.noaa.gov/disclaimers.html',
        attribution_url: 'https://tidesandcurrents.noaa.gov/web_services_info.html',
        allowed_live_environments: allLiveEnvironments,
      },
      operations: {
        refresh_seconds: 360,
        fresh_cache_seconds: 360,
        max_stale_seconds: 1_800,
        upstream_rate_limit:
          'GEV cap 240 requests/hour with at most four concurrent station requests',
        budget_policy:
          'No source fee; AOI station allowlist, 100-station ceiling, and shared station caches are mandatory',
        timeout_ms: 10_000,
        max_response_bytes: 2_097_152,
        max_records: 10_000,
        max_concurrency: 4,
        kill_switch: 'GEV_COOPS_ENABLED',
        fallback:
          'Last-valid observations may remain stale for 30 minutes; predictions never extend past their valid time',
      },
    },
  },
  {
    id: 'noaa-nowcoast',
    name: 'NOAA nowCOAST / NWS Map Services',
    source: {
      name: 'NWS time-enabled MRMS base reflectivity image service',
      url: 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer',
      license_id: 'us-government-public-domain',
      license: 'NWS public-domain notice and map-service appropriate-use policy',
      attribution: 'NOAA / National Weather Service / MRMS',
    },
    implementation: 'planned',
    supported_modes: ['seed', 'live'],
    feeds: [
      {
        id: 'nowcoast-radar-reflectivity',
        name: 'Time-enabled MRMS radar base reflectivity',
        implementation: 'planned',
        freshness: noFreshness('Bounded delivery and render spike is not complete'),
      },
    ],
    layers: [
      {
        id: 'nowcoast-radar',
        name: 'Time-enabled radar reflectivity',
        implementation: 'planned',
        documentation_path: 'docs/data-sources/nowcoast-radar.md',
      },
    ],
    source_access: {
      evidence_reviewed_on: '2026-09-05',
      decision_rank: 6,
      products: [
        {
          id: 'nws-mrms-base-reflectivity-time',
          name: 'MRMS radar base reflectivity time imagery',
          transport: 'https',
          endpoints: [
            'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer',
          ],
          formats: ['ArcGIS ImageServer export image', 'OGC WMS 1.3.0'],
          coverage: 'CONUS, Alaska, Caribbean, Guam, and Hawaii',
          time_semantics:
            'UTC time slices within a moving four-hour service window; latest is not wall-clock truth',
        },
      ],
      credential: {
        kind: 'identified_user_agent',
        setup_url: 'https://nowcoast.noaa.gov/',
        required_scopes: noScopes,
        validation_method:
          'Server configuration validates an identifiable User-Agent and fixed service root',
      },
      approval: {
        owner: 'gev-data-licensing-owner',
        status: 'record_required',
        terms_url: 'https://www.weather.gov/disclaimer/',
        attribution_url:
          'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer',
        allowed_live_environments: allLiveEnvironments,
      },
      operations: {
        refresh_seconds: 300,
        fresh_cache_seconds: 300,
        max_stale_seconds: 1_800,
        upstream_rate_limit: 'At most one export per normalized AOI/time/size every 5 minutes',
        budget_policy:
          'No source fee; spike is capped at 1,024 px square, one time slice, and 12 refreshes/hour',
        timeout_ms: 15_000,
        max_response_bytes: 4_194_304,
        max_records: 1,
        max_concurrency: 2,
        kill_switch: 'GEV_NOWCOAST_RADAR_ENABLED',
        fallback:
          'Use a visibly stale image for at most 30 minutes; do not fall back to RainViewer',
      },
    },
  },
  {
    id: 'noaa-goes-glm',
    name: 'NOAA GOES-R Geostationary Lightning Mapper',
    source: {
      name: 'GOES-R GLM Level 2 Lightning Detection',
      url: 'https://www.ncei.noaa.gov/metadata/geoportal/rest/metadata/item/gov.noaa.ncdc%3AC01527/html',
      license_id: 'us-government-public-domain',
      license: 'NOAA public-data notice; dataset citation and product-quality notices apply',
      attribution:
        'NOAA GOES-R Series Program and NOAA National Centers for Environmental Information',
    },
    implementation: 'planned',
    supported_modes: ['seed', 'live'],
    feeds: [
      {
        id: 'goes-glm-lightning',
        name: 'GOES-18/19 GLM Level 2 flashes',
        implementation: 'planned',
        freshness: noFreshness('Bounded NetCDF delivery and render spike is not complete'),
      },
    ],
    layers: [
      {
        id: 'goes-glm-lightning',
        name: 'GOES GLM lightning flashes',
        implementation: 'planned',
        documentation_path: 'docs/data-sources/goes-glm.md',
      },
    ],
    source_access: {
      evidence_reviewed_on: '2026-09-05',
      decision_rank: 7,
      products: [
        {
          id: 'glm-l2-lcfa',
          name: 'GLM Level 2 Lightning Detection events, groups, and flashes',
          transport: 'https',
          endpoints: [
            'https://noaa-goes18.s3.amazonaws.com/GLM-L2-LCFA/',
            'https://noaa-goes19.s3.amazonaws.com/GLM-L2-LCFA/',
          ],
          formats: ['NetCDF4 GLM-L2-LCFA 20-second granules'],
          coverage: 'Americas and adjacent oceans within the GOES-East/West GLM fields of view',
          time_semantics:
            'Granule start/end/creation times and flash times remain distinct from retrieval time',
        },
      ],
      credential: {
        kind: 'none',
        setup_url: 'https://www.ncei.noaa.gov/products/goes-terrestrial-weather-abi-glm',
        required_scopes: noScopes,
        validation_method:
          'No key; fixed public-bucket roots and product prefixes are validated before dispatch',
      },
      approval: {
        owner: 'gev-data-licensing-owner',
        status: 'record_required',
        terms_url: 'https://www.noaa.gov/disclaimer',
        attribution_url:
          'https://www.ncei.noaa.gov/metadata/geoportal/rest/metadata/item/gov.noaa.ncdc%3AC01527/html',
        allowed_live_environments: allLiveEnvironments,
      },
      operations: {
        refresh_seconds: 20,
        fresh_cache_seconds: 20,
        max_stale_seconds: 120,
        upstream_rate_limit:
          'At most one object listing per satellite every 20 seconds; immutable granules fetched once',
        budget_policy:
          'No source fee; spike caps two satellites, 30 granules, 2 MiB/granule, and 60 MiB total input',
        timeout_ms: 15_000,
        max_response_bytes: 2_097_152,
        max_records: 30,
        max_concurrency: 2,
        kill_switch: 'GEV_GOES_GLM_ENABLED',
        fallback:
          'No alternate lightning source; report unavailable after the two-minute stale limit',
      },
    },
  },
] satisfies readonly PlannedOperationalProviderDefinition[];
