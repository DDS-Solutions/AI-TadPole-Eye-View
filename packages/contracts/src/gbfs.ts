import { z } from 'zod';
import { DataProvenanceSchema } from './provenance.js';

/**
 * Normalized GBFS (General Bikeshare Feed Specification) station contract.
 */
export const BikeStation = z.object({
  /** Station unique identifier. */
  station_id: z.string().min(1),
  /** Station human-readable name. */
  name: z.string().default('Bikeshare Station'),
  /** WGS84 Longitude [-180, 180]. */
  longitude: z.number().finite().min(-180).max(180),
  /** WGS84 Latitude [-90, 90]. */
  latitude: z.number().finite().min(-90).max(90),
  /** Total bike dock capacity. */
  capacity: z.number().int().nonnegative().default(0),
  /** Number of operational bikes available for rent. */
  num_bikes_available: z.number().int().nonnegative().default(0),
  /** Number of operational empty docks available. */
  num_docks_available: z.number().int().nonnegative().default(0),
  /** True if station is installed and functional. */
  is_installed: z.boolean().default(true),
  /** True if station is actively renting bikes. */
  is_renting: z.boolean().default(true),
  /** True if station is actively accepting bike returns. */
  is_returning: z.boolean().default(true),
});
export type BikeStation = z.infer<typeof BikeStation>;

/**
 * Batch container for GBFS station feed.
 */
export const BikeStationBatchPayload = z.object({
  time: z.number().int().nonnegative(),
  system_id: z.string().default('gbfs'),
  stations: z.array(BikeStation),
});
export type BikeStationBatchPayload = z.infer<typeof BikeStationBatchPayload>;

export const BikeStationBatch = BikeStationBatchPayload.extend({
  provenance: DataProvenanceSchema,
});
export type BikeStationBatch = z.infer<typeof BikeStationBatch>;
