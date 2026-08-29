import { z } from 'zod';
import { DataProvenanceSchema } from './provenance.js';

/**
 * Normalized USGS Earthquake telemetry feature contract.
 * Conforms to GeoJSON USGS Real-Time Earthquake standard.
 */
export const EarthquakeFeature = z.object({
  /** Unique USGS Event ID (e.g. "us7000m97q"). */
  id: z.string().min(1),
  /** Richter / Moment magnitude. */
  mag: z.number().finite(),
  /** Text description of location (e.g. "12 km SW of Leilani Estates, Hawaii"). */
  place: z.string().default('Unknown Location'),
  /** Epoch timestamp in milliseconds. */
  time: z.number().int().nonnegative(),
  /** Updated epoch timestamp in milliseconds. */
  updated: z.number().int().nonnegative().optional(),
  /** WGS84 Longitude [-180, 180]. */
  longitude: z.number().finite().min(-180).max(180),
  /** WGS84 Latitude [-90, 90]. */
  latitude: z.number().finite().min(-90).max(90),
  /** Hypocentral focal depth in kilometers. */
  depth_km: z.number().finite().default(10),
  /** Significance score (0-1000). */
  significance: z.number().finite().nonnegative().default(0),
  /** USGS Alert level: green, yellow, orange, red. */
  alert: z.enum(['green', 'yellow', 'orange', 'red']).nullable().optional(),
  /** Tsunami warning flag (0 = no, 1 = warning issued). */
  tsunami: z.number().int().default(0),
  /** USGS Event status (automatic, reviewed). */
  status: z.string().default('reviewed'),
});
export type EarthquakeFeature = z.infer<typeof EarthquakeFeature>;

/**
 * Collection container for earthquake feed.
 */
export const EarthquakeCollectionPayload = z.object({
  time: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  features: z.array(EarthquakeFeature),
});
export type EarthquakeCollectionPayload = z.infer<typeof EarthquakeCollectionPayload>;

export const EarthquakeCollection = EarthquakeCollectionPayload.extend({
  provenance: DataProvenanceSchema,
});
export type EarthquakeCollection = z.infer<typeof EarthquakeCollection>;
