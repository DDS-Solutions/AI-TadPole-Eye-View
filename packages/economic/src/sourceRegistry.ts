import type { EconomicGeographyLevel } from '@gev/contracts';
import { z } from 'zod';

export const EconomicSourceIdSchema = z.enum([
  'census-acs',
  'census-cbp-zbp',
  'bls-oews',
  'bls-lau',
  'fema-nri-nfhl',
  'usgs-3dep',
  'epa-aqs',
  'dot-bts-access',
  'osm-commercial',
]);
export type EconomicSourceId = z.infer<typeof EconomicSourceIdSchema>;

export const EconomicSourceStatusSchema = z.enum([
  'planned',
  'seed',
  'download_pack',
  'implemented',
]);
export type EconomicSourceStatus = z.infer<typeof EconomicSourceStatusSchema>;

export const EconomicSourceMetadataSchema = z
  .object({
    id: EconomicSourceIdSchema,
    name: z.string().min(1).max(200),
    agency: z.string().min(1).max(200),
    description: z.string().min(1).max(1000),
    canonical_url: z.string().url(),
    terms_url: z.string().url(),
    license_id: z.string().min(1).max(64),
    attribution_notice: z.string().min(1).max(500),
    supported_geographies: z.array(z.custom<EconomicGeographyLevel>()).min(1),
    update_cadence: z.string().min(1).max(100),
    vintage_description: z.string().min(1).max(200),
    status: EconomicSourceStatusSchema,
    suppression_supported: z.boolean(),
    margin_of_error_supported: z.boolean(),
  })
  .strict();
export type EconomicSourceMetadata = z.infer<typeof EconomicSourceMetadataSchema>;

export const ECONOMIC_SOURCE_REGISTRY: Record<EconomicSourceId, EconomicSourceMetadata> = {
  'census-acs': {
    id: 'census-acs',
    name: 'American Community Survey (ACS) 5-Year Estimates',
    agency: 'U.S. Census Bureau',
    description:
      'Detailed demographic, social, economic, and housing characteristics down to the tract and block group level.',
    canonical_url: 'https://www.census.gov/programs-surveys/acs',
    terms_url: 'https://www.census.gov/data/developers/about/terms-of-service.html',
    license_id: 'us-government-public-domain',
    attribution_notice: 'U.S. Census Bureau, American Community Survey 5-Year Estimates',
    supported_geographies: [
      'nation',
      'state',
      'county',
      'tract',
      'block_group',
      'zcta',
      'cbsa',
      'place',
    ],
    update_cadence: 'Annual (5-year rolling pooling)',
    vintage_description:
      '5-year pooled survey estimates with explicit 90% confidence margins of error',
    status: 'planned',
    suppression_supported: true,
    margin_of_error_supported: true,
  },
  'census-cbp-zbp': {
    id: 'census-cbp-zbp',
    name: 'County Business Patterns & ZIP Code Business Patterns',
    agency: 'U.S. Census Bureau',
    description:
      'Economic data on business establishments, total employment, and first-quarter and annual payroll by NAICS code.',
    canonical_url: 'https://www.census.gov/programs-surveys/cbp.html',
    terms_url: 'https://www.census.gov/data/developers/about/terms-of-service.html',
    license_id: 'us-government-public-domain',
    attribution_notice: 'U.S. Census Bureau, County and ZIP Code Business Patterns',
    supported_geographies: ['nation', 'state', 'county', 'zcta', 'cbsa'],
    update_cadence: 'Annual',
    vintage_description: 'Annual enterprise census with statutory disclosure avoidance suppression',
    status: 'planned',
    suppression_supported: true,
    margin_of_error_supported: false,
  },
  'bls-oews': {
    id: 'bls-oews',
    name: 'Occupational Employment and Wage Statistics (OEWS)',
    agency: 'U.S. Bureau of Labor Statistics',
    description:
      'Employment and wage estimates for roughly 830 occupations across nation, states, and metropolitan areas.',
    canonical_url: 'https://www.bls.gov/oes/',
    terms_url: 'https://www.bls.gov/bls/linksite.htm',
    license_id: 'us-government-public-domain',
    attribution_notice:
      'U.S. Bureau of Labor Statistics, Occupational Employment and Wage Statistics',
    supported_geographies: ['nation', 'state', 'cbsa'],
    update_cadence: 'Annual (May survey release)',
    vintage_description: 'Annual occupational survey with percentile wage distributions',
    status: 'planned',
    suppression_supported: true,
    margin_of_error_supported: false,
  },
  'bls-lau': {
    id: 'bls-lau',
    name: 'Local Area Unemployment Statistics (LAU)',
    agency: 'U.S. Bureau of Labor Statistics',
    description:
      'Monthly labor force, employment, unemployment, and unemployment rate estimates for local geographic areas.',
    canonical_url: 'https://www.bls.gov/lau/',
    terms_url: 'https://www.bls.gov/bls/linksite.htm',
    license_id: 'us-government-public-domain',
    attribution_notice: 'U.S. Bureau of Labor Statistics, Local Area Unemployment Statistics',
    supported_geographies: ['nation', 'state', 'county', 'cbsa', 'place'],
    update_cadence: 'Monthly',
    vintage_description:
      'Monthly model-based and administrative estimates with benchmark revisions',
    status: 'planned',
    suppression_supported: false,
    margin_of_error_supported: false,
  },
  'fema-nri-nfhl': {
    id: 'fema-nri-nfhl',
    name: 'National Risk Index & National Flood Hazard Layer',
    agency: 'Federal Emergency Management Agency (FEMA)',
    description:
      'Natural hazard risk assessment, expected annual loss, social vulnerability, and official special flood hazard areas.',
    canonical_url: 'https://www.fema.gov/flood-maps/products-tools/national-risk-index',
    terms_url: 'https://www.fema.gov/about/openfema/terms-conditions',
    license_id: 'us-government-public-domain',
    attribution_notice: 'Federal Emergency Management Agency (FEMA), National Risk Index',
    supported_geographies: ['state', 'county', 'tract', 'bounding_box'],
    update_cadence: 'Periodic / Multi-year update',
    vintage_description: 'Census-tract level natural hazard risk index composite scores',
    status: 'planned',
    suppression_supported: false,
    margin_of_error_supported: false,
  },
  'usgs-3dep': {
    id: 'usgs-3dep',
    name: '3D Elevation Program (3DEP)',
    agency: 'U.S. Geological Survey',
    description:
      'High-resolution bare-earth digital elevation models (DEMs) and topographic point query services.',
    canonical_url: 'https://www.usgs.gov/3d-elevation-program',
    terms_url: 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',
    license_id: 'us-government-public-domain',
    attribution_notice: 'U.S. Geological Survey, 3D Elevation Program (3DEP)',
    supported_geographies: ['point', 'bounding_box'],
    update_cadence: 'Continuous lidar acquisition',
    vintage_description: 'Topographic elevation in meters above NAD83/NAVD88 datum',
    status: 'planned',
    suppression_supported: false,
    margin_of_error_supported: false,
  },
  'epa-aqs': {
    id: 'epa-aqs',
    name: 'Air Quality System (AQS)',
    agency: 'U.S. Environmental Protection Agency',
    description:
      'Historical ambient air quality monitoring data for criteria pollutants (ozone, PM2.5, PM10, CO, NO2, SO2).',
    canonical_url: 'https://www.epa.gov/aqs',
    terms_url: 'https://www.epa.gov/privacy/privacy-act-laws-policies-and-resources',
    license_id: 'us-government-public-domain',
    attribution_notice: 'U.S. Environmental Protection Agency, Air Quality System',
    supported_geographies: ['state', 'county', 'cbsa', 'point', 'bounding_box'],
    update_cadence: 'Quarterly regulatory upload',
    vintage_description:
      'Regulatory monitoring station measurements; historical screening data only',
    status: 'planned',
    suppression_supported: false,
    margin_of_error_supported: false,
  },
  'dot-bts-access': {
    id: 'dot-bts-access',
    name: 'Transportation & Accessibility Infrastructure Metrics',
    agency: 'U.S. Bureau of Transportation Statistics / DOT',
    description:
      'Multimodal transportation accessibility, freight networks, commute patterns, and national transit GIS.',
    canonical_url: 'https://www.bts.gov/',
    terms_url: 'https://www.bts.gov/privacy',
    license_id: 'us-government-public-domain',
    attribution_notice: 'U.S. Department of Transportation, Bureau of Transportation Statistics',
    supported_geographies: ['nation', 'state', 'county', 'cbsa', 'place', 'tract'],
    update_cadence: 'Annual',
    vintage_description: 'National freight and passenger accessibility benchmarks',
    status: 'planned',
    suppression_supported: false,
    margin_of_error_supported: false,
  },
  'osm-commercial': {
    id: 'osm-commercial',
    name: 'OpenStreetMap Commercial & Amenity Infrastructure',
    agency: 'OpenStreetMap Community',
    description:
      'Crowdsourced vector points of interest, retail facilities, dining, services, and commercial footprints.',
    canonical_url: 'https://www.openstreetmap.org/',
    terms_url: 'https://www.openstreetmap.org/copyright',
    license_id: 'odbl-1.0',
    attribution_notice: '© OpenStreetMap contributors (ODbL 1.0)',
    supported_geographies: ['bounding_box', 'point'],
    update_cadence: 'Real-time crowdsourced updates (queried via Overpass QL)',
    vintage_description: 'Vector geometries and tag attributes sanitized through Overpass QL',
    status: 'planned',
    suppression_supported: false,
    margin_of_error_supported: false,
  },
};

export function getEconomicSource(id: EconomicSourceId): EconomicSourceMetadata {
  const source = ECONOMIC_SOURCE_REGISTRY[id];
  if (!source) {
    throw new Error(`Unknown economic source ID: ${id}`);
  }
  return source;
}

export function listEconomicSources(): EconomicSourceMetadata[] {
  return Object.values(ECONOMIC_SOURCE_REGISTRY);
}

export function isEconomicSourceRegistered(id: string): id is EconomicSourceId {
  return id in ECONOMIC_SOURCE_REGISTRY;
}
