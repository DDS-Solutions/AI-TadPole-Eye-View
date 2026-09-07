import type { ProviderSourceAccess } from '@gev/contracts';
import type { ProviderDefinition } from './registryDefinitions.js';

type LiveEnvironment = 'development' | 'staging' | 'production';

export type OperationalAccessDecision = ProviderSourceAccess;

export interface PlannedOperationalProviderDefinition extends ProviderDefinition {
  source_access: OperationalAccessDecision;
}

export const noFreshness = (reason: string) => ({
  status: 'unavailable' as const,
  reason,
});
export const definedFreshness = (freshForSeconds: number) => ({
  status: 'defined' as const,
  fresh_for_seconds: freshForSeconds,
});

export const noScopes: string[] = [];
export const allLiveEnvironments: LiveEnvironment[] = ['development', 'staging', 'production'];

export const OPERATIONAL_AWARENESS_PROVIDER_DEFINITIONS = [
  {
    id: 'gev-solar-context',
    name: 'GEV deterministic solar context',
    source: {
      name: 'GEV deterministic solar context',
      url: 'https://github.com/DDS-Solutions/AI-TadPole-Eye-View',
      license_id: 'mit',
      license: 'MIT-licensed GEV pure-domain calculation',
      attribution: 'DDS-Solutions GEV; twilight definitions referenced to U.S. Naval Observatory',
    },
    implementation: 'implemented',
    supported_modes: ['seed', 'live'],
    feeds: [
      {
        id: 'solar-context',
        name: 'SimClock solar position and twilight context',
        implementation: 'implemented',
        freshness: definedFreshness(1),
      },
    ],
    layers: [
      {
        id: 'solar-context',
        name: 'Day, night, and twilight context',
        implementation: 'implemented',
        documentation_path: 'docs/data-sources/solar-context.md',
      },
    ],
    source_access: {
      domain: 'environment',
      evidence_reviewed_on: '2026-09-05',
      decision_rank: 1,
      products: [
        {
          id: 'simclock-solar-terminator',
          name: 'Subsolar point plus day/night and civil/nautical/astronomical twilight bands',
          transport: 'internal',
          endpoints: ['packages/core pure-domain boundary'],
          formats: ['validated TypeScript domain objects'],
          coverage: 'Global, including polar day and polar night',
          time_semantics: 'Computed solely from injected SimClock UTC time; never wall-clock time',
        },
      ],
      credential: {
        kind: 'none',
        setup_url: 'https://aa.usno.navy.mil/faq/RST_defs',
        required_scopes: noScopes,
        validation_method: 'No secret or network validation; conformance vectors are offline',
      },
      approval: {
        owner: 'gev-data-licensing-owner',
        status: 'not_required',
        terms_url: 'https://github.com/DDS-Solutions/AI-TadPole-Eye-View',
        attribution_url: 'https://aa.usno.navy.mil/faq/RST_defs',
        allowed_live_environments: allLiveEnvironments,
      },
      configuration: {
        status: 'not_required',
        description: 'No provider endpoint or credential configuration is required.',
      },
      operations: {
        refresh_seconds: 1,
        fresh_cache_seconds: 1,
        max_stale_seconds: 1,
        upstream_rate_limit: 'No upstream requests; render updates are capped at 1 Hz',
        budget_policy:
          'Zero network and monetary budget; existing Cesium frame budget still applies',
        timeout_ms: 100,
        max_response_bytes: 262_144,
        max_records: 1,
        max_concurrency: 1,
        kill_switch: 'GEV_SOLAR_CONTEXT_ENABLED',
        kill_switch_owner: 'gev-platform-administrator',
        fallback: 'Hide the overlay and report unavailable; never substitute wall-clock time',
      },
      setup_instructions: [
        'Review the deterministic calculation and twilight definitions.',
        'Confirm the platform policy enables the solar context layer.',
      ],
    },
  },
  {
    id: 'noaa-nws-alerts',
    name: 'NOAA National Weather Service alerts',
    source: {
      name: 'NWS Alerts Web Service',
      url: 'https://www.weather.gov/documentation/services-web-alerts',
      license_id: 'us-government-public-domain',
      license: 'NWS public-domain notice and service-use policy; source-specific exceptions apply',
      attribution: 'NOAA / National Weather Service',
    },
    implementation: 'implemented',
    supported_modes: ['seed', 'live'],
    feeds: [
      {
        id: 'nws-alerts',
        name: 'Active NWS CAP alerts',
        implementation: 'implemented',
        freshness: definedFreshness(30),
      },
    ],
    layers: [
      {
        id: 'nws-alerts',
        name: 'NWS watches, warnings, and advisories',
        implementation: 'implemented',
        documentation_path: 'docs/data-sources/nws-alerts.md',
      },
    ],
    source_access: {
      domain: 'alerts',
      evidence_reviewed_on: '2026-09-05',
      decision_rank: 2,
      products: [
        {
          id: 'nws-active-alerts',
          name: 'Active CAP v1.2 alert index and products',
          transport: 'https',
          endpoints: ['https://api.weather.gov/alerts/active'],
          formats: ['GeoJSON', 'JSON-LD', 'CAP v1.2 XML'],
          coverage:
            'United States, territories, and NWS marine zones; documented CAP gaps remain explicit',
          time_semantics:
            'CAP sent/effective/onset/expires/ends and update references are preserved independently',
        },
      ],
      credential: {
        kind: 'identified_user_agent',
        setup_url: 'https://www.weather.gov/documentation/services-web-api',
        required_scopes: noScopes,
        validation_method:
          'Server configuration validates a stable contact-bearing User-Agent before dispatch',
      },
      approval: {
        owner: 'gev-data-licensing-owner',
        status: 'record_required',
        terms_url: 'https://www.weather.gov/disclaimer/',
        attribution_url: 'https://www.weather.gov/documentation/services-web-alerts',
        allowed_live_environments: allLiveEnvironments,
      },
      configuration: {
        status: 'required',
        description: 'A stable contact-bearing User-Agent is required for live requests.',
      },
      operations: {
        refresh_seconds: 30,
        fresh_cache_seconds: 30,
        max_stale_seconds: 300,
        upstream_rate_limit: 'At most one request per normalized AOI every 30 seconds process-wide',
        budget_policy:
          'No source fee; cap at 120 upstream requests/hour and one shared single-flight cache',
        timeout_ms: 10_000,
        max_response_bytes: 2_097_152,
        max_records: 500,
        max_concurrency: 2,
        kill_switch: 'GEV_NWS_ALERTS_ENABLED',
        kill_switch_owner: 'gev-platform-administrator',
        fallback:
          'Use visibly stale last-valid alerts for at most 5 minutes; then report unavailable',
      },
      setup_instructions: [
        'Review the NWS service guidance, disclaimer, attribution, and CAP limitations.',
        'Have the licensing owner record approved use before any live activation.',
        'Configure the required contact-bearing User-Agent through the server authority.',
      ],
    },
  },
  {
    id: 'noaa-aviation-weather-center',
    name: 'NOAA Aviation Weather Center',
    source: {
      name: 'Aviation Weather Center Data API',
      url: 'https://aviationweather.gov/data/api/',
      license_id: 'us-government-public-domain',
      license:
        'NWS public-domain notice and AWC Data API restrictions; source-specific exceptions apply',
      attribution: 'NOAA / National Weather Service / Aviation Weather Center',
    },
    implementation: 'implemented',
    supported_modes: ['seed', 'live'],
    feeds: [
      {
        id: 'aviation-metar',
        name: 'METAR terminal observations',
        implementation: 'implemented',
        freshness: definedFreshness(60),
      },
      {
        id: 'aviation-taf',
        name: 'TAF terminal forecasts',
        implementation: 'implemented',
        freshness: definedFreshness(60),
      },
      {
        id: 'aviation-sigmet',
        name: 'SIGMET aviation warnings',
        implementation: 'implemented',
        freshness: definedFreshness(60),
      },
    ],
    layers: [
      {
        id: 'aviation-weather',
        name: 'Aviation observations, forecasts, and warnings',
        implementation: 'implemented',
        documentation_path: 'docs/data-sources/aviation-weather.md',
      },
    ],
    source_access: {
      domain: 'aviation-weather',
      evidence_reviewed_on: '2026-09-05',
      decision_rank: 3,
      products: [
        {
          id: 'awc-metar',
          name: 'METAR terminal observations',
          transport: 'https',
          endpoints: ['https://aviationweather.gov/api/data/metar'],
          formats: ['GeoJSON'],
          coverage: 'Worldwide reporting stations',
          time_semantics: 'Observation time is distinct from retrieval and cache time',
        },
        {
          id: 'awc-taf',
          name: 'TAF terminal forecasts',
          transport: 'https',
          endpoints: ['https://aviationweather.gov/api/data/taf'],
          formats: ['GeoJSON'],
          coverage: 'Worldwide reporting stations',
          time_semantics: 'Issue time and forecast validity interval are preserved',
        },
        {
          id: 'awc-airsigmet',
          name: 'SIGMET aviation warnings',
          transport: 'https',
          endpoints: ['https://aviationweather.gov/api/data/airsigmet'],
          formats: ['GeoJSON'],
          coverage: 'Worldwide SIGMET products exposed by AWC',
          time_semantics: 'Issue and valid-from/valid-to times govern display and expiry',
        },
      ],
      credential: {
        kind: 'identified_user_agent',
        setup_url: 'https://aviationweather.gov/data/api/',
        required_scopes: noScopes,
        validation_method:
          'Server configuration validates a stable descriptive User-Agent before dispatch',
      },
      approval: {
        owner: 'gev-data-licensing-owner',
        status: 'record_required',
        terms_url: 'https://www.weather.gov/disclaimer/',
        attribution_url: 'https://aviationweather.gov/data/api/',
        allowed_live_environments: allLiveEnvironments,
      },
      configuration: {
        status: 'required',
        description: 'A stable descriptive User-Agent is required for live requests.',
      },
      operations: {
        refresh_seconds: 60,
        fresh_cache_seconds: 60,
        max_stale_seconds: 7_200,
        upstream_rate_limit:
          'GEV cap 60 requests/hour/product, below the documented 100 requests/minute ceiling',
        budget_policy:
          'No source fee; AOI queries, a 400-record/product ceiling, and shared caches are mandatory',
        timeout_ms: 10_000,
        max_response_bytes: 4_194_304,
        max_records: 400,
        max_concurrency: 2,
        kill_switch: 'GEV_AWC_WEATHER_ENABLED',
        kill_switch_owner: 'gev-platform-administrator',
        fallback:
          'Retain last-valid data only inside source validity; expired products disappear, never roll forward',
      },
      setup_instructions: [
        'Review the AWC Data API restrictions, attribution, and product validity semantics.',
        'Have the licensing owner record approved use before any live activation.',
        'Configure the required descriptive User-Agent through the server authority.',
      ],
    },
  },
  {
    id: 'noaa-national-hurricane-center',
    name: 'NOAA National Hurricane Center',
    source: {
      name: 'NHC and CPHC GIS advisory feeds',
      url: 'https://www.nhc.noaa.gov/gis/rss.php',
      license_id: 'us-government-public-domain',
      license: 'NWS public-domain notice; experimental GIS service disclaimer applies',
      attribution: 'NOAA / National Hurricane Center and Central Pacific Hurricane Center',
    },
    implementation: 'implemented',
    supported_modes: ['seed', 'live'],
    feeds: [
      {
        id: 'tropical-cyclone-advisories',
        name: 'Current NHC and CPHC GIS advisories',
        implementation: 'implemented',
        freshness: definedFreshness(300),
      },
    ],
    layers: [
      {
        id: 'tropical-cyclones',
        name: 'Tropical cyclone tracks, cones, and watches/warnings',
        implementation: 'implemented',
        documentation_path: 'docs/data-sources/tropical-cyclones.md',
      },
    ],
    source_access: {
      domain: 'tropical-weather',
      evidence_reviewed_on: '2026-09-06',
      decision_rank: 4,
      products: [
        {
          id: 'nhc-gis-rss',
          name: 'Advisory forecast track, cone, and coastal watches/warnings',
          transport: 'https',
          endpoints: [
            'https://www.nhc.noaa.gov/gis-at.xml',
            'https://www.nhc.noaa.gov/gis-ep.xml',
            'https://www.nhc.noaa.gov/gis-cp.xml',
          ],
          formats: ['RSS XML index', 'same-origin KMZ/KML advisory assets'],
          coverage: 'Atlantic, Eastern Pacific, and Central Pacific basins',
          time_semantics:
            'Advisory number, issue time, forecast valid time, and observation time remain distinct',
        },
      ],
      credential: {
        kind: 'identified_user_agent',
        setup_url: 'https://www.nhc.noaa.gov/mobile/rss.html',
        required_scopes: noScopes,
        validation_method:
          'Server configuration validates an identifiable User-Agent and fixed basin allowlist',
      },
      approval: {
        owner: 'gev-data-licensing-owner',
        status: 'record_required',
        terms_url: 'https://www.weather.gov/disclaimer/',
        attribution_url: 'https://www.nhc.noaa.gov/gis/rss.php',
        allowed_live_environments: allLiveEnvironments,
      },
      configuration: {
        status: 'required',
        description: 'An identifiable User-Agent and fixed basin allowlist are required.',
      },
      operations: {
        refresh_seconds: 300,
        fresh_cache_seconds: 300,
        max_stale_seconds: 21_600,
        upstream_rate_limit:
          'At most one RSS request per basin every 5 minutes; assets cached by immutable advisory URL',
        budget_policy:
          'No source fee; three basin indexes, 256 index items, and one bounded asset per product',
        timeout_ms: 10_000,
        max_response_bytes: 5_242_880,
        max_records: 256,
        max_concurrency: 2,
        kill_switch: 'GEV_NHC_TROPICAL_CYCLONES_ENABLED',
        kill_switch_owner: 'gev-platform-administrator',
        fallback:
          'Archive data is never substituted as current; stale advisories remain labeled and expire by source validity',
      },
      setup_instructions: [
        'Review NHC GIS availability, disclaimer, attribution, and advisory validity semantics.',
        'Have the licensing owner record approved use before any live activation.',
        'Configure the identifiable User-Agent and retain the fixed basin allowlist.',
      ],
    },
  },
] satisfies readonly PlannedOperationalProviderDefinition[];
