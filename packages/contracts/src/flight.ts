import { z } from 'zod';
import { DataProvenanceSchema } from './provenance.js';

/**
 * Geographic bounding box for spatial queries.
 * Cross-field ordering enforced: min_lat <= max_lat and min_lon <= max_lon.
 * Antimeridian wrapping (min_lon > max_lon) is rejected with named error ANTIMERIDIAN_UNSUPPORTED in v0.1.
 */
export const BoundingBox = z
  .object({
    min_lat: z.number().finite().min(-90).max(90),
    max_lat: z.number().finite().min(-90).max(90),
    min_lon: z.number().finite().min(-180).max(180),
    max_lon: z.number().finite().min(-180).max(180),
  })
  .refine((b) => b.min_lat <= b.max_lat, {
    message: 'min_lat must not exceed max_lat',
  })
  .refine((b) => b.min_lon <= b.max_lon, {
    message:
      'ANTIMERIDIAN_UNSUPPORTED: min_lon must not exceed max_lon (antimeridian wrapping is unsupported in v0.1)',
  });
export type BoundingBox = z.infer<typeof BoundingBox>;

/**
 * Position source enum matching OpenSky standard:
 * 0: ADS-B
 * 1: ASTERIX
 * 2: MLAT
 * 3: FLARM
 */
export const PositionSource = z.enum(['ADSB', 'ASTERIX', 'MLAT', 'FLARM', 'UNKNOWN']);
export type PositionSource = z.infer<typeof PositionSource>;

/**
 * Normalized flight state vector contract.
 * Mirrors OpenSky / ADSB state vector data in a clean, typed structure.
 * All physical quantities strictly require finite numbers.
 */
export const FlightState = z.object({
  /** 24-bit ICAO transponder address (hex format). */
  icao24: z.string().min(1).max(12),
  /** Callsign (8 characters max, trimmed). */
  callsign: z.string().nullable().optional(),
  /** Country name inferred from ICAO address block. */
  origin_country: z.string().default(''),
  /** Unix timestamp in seconds for position observation. */
  time_position: z.number().int().nonnegative().nullable().optional(),
  /** Unix timestamp in seconds for last received message. */
  last_contact: z.number().int().nonnegative(),
  /** WGS84 Longitude in decimal degrees [-180, 180]. */
  longitude: z.number().finite().min(-180).max(180).nullable(),
  /** WGS84 Latitude in decimal degrees [-90, 90]. */
  latitude: z.number().finite().min(-90).max(90).nullable(),
  /** Barometric altitude in meters. */
  baro_altitude: z.number().finite().nullable().optional(),
  /** True if aircraft is broadcasting on-ground status. */
  on_ground: z.boolean().default(false),
  /** Ground speed in meters per second. */
  velocity: z.number().finite().nonnegative().nullable().optional(),
  /** True track in decimal degrees clockwise from north [0, 360). */
  true_track: z.number().finite().min(0).max(360).nullable().optional(),
  /** Vertical speed in meters per second (positive = climbing). */
  vertical_rate: z.number().finite().nullable().optional(),
  /** Geometric altitude (WGS84 ellipsoid height) in meters. */
  geo_altitude: z.number().finite().nullable().optional(),
  /** 4-digit transponder squawk code. */
  squawk: z.string().nullable().optional(),
  /** Special Purpose Indicator flag. */
  spi: z.boolean().default(false),
  /** Source of positional telemetry. */
  position_source: PositionSource.default('ADSB'),
});
export type FlightState = z.infer<typeof FlightState>;

/**
 * Batch response container for flight feed ingestion.
 */
export const FlightBatchPayload = z.object({
  /** Server timestamp of snapshot ingestion in unix seconds. */
  time: z.number().int().nonnegative(),
  /** Collection of aircraft state vectors. */
  states: z.array(FlightState),
});
export type FlightBatchPayload = z.infer<typeof FlightBatchPayload>;

export const FlightBatch = FlightBatchPayload.extend({
  provenance: DataProvenanceSchema,
});
export type FlightBatch = z.infer<typeof FlightBatch>;
