import {
  type EconomicFixtureDataset,
  EconomicFixtureDatasetSchema,
  type OsmCommercialPoiResponse,
  OsmCommercialPoiResponseSchema,
} from '@gev/contracts';

/**
 * Pure parser validating an economic fixture dataset against EconomicFixtureDatasetSchema.
 * Strictly enforces zero I/O, contract validation, and seed mode provenance.
 */
export function parseEconomicFixtureDataset(rawJson: string | unknown): EconomicFixtureDataset {
  const parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
  return EconomicFixtureDatasetSchema.parse(parsed);
}

/**
 * Pure parser validating an OSM commercial POI fixture response against OsmCommercialPoiResponseSchema.
 * Strictly enforces zero I/O, contract validation, and seed mode provenance.
 */
export function parseOsmCommercialPoiFixture(rawJson: string | unknown): OsmCommercialPoiResponse {
  const parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
  return OsmCommercialPoiResponseSchema.parse(parsed);
}
