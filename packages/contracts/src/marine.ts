import { z } from 'zod';
import { DataProvenanceSchema } from './provenance.js';

/**
 * Normalized AIS Marine telemetry state vector contract.
 * Mirrors AIS Type 1, 2, 3, 5, 18, 19, 24 messages.
 */
export const ShipState = z.object({
  /** Maritime Mobile Service Identity (9-digit unique ship ID). */
  mmsi: z.string().min(1).max(12),
  /** Ship name (if broadcast in static data). */
  name: z.string().nullable().optional(),
  /** Radio callsign. */
  callsign: z.string().nullable().optional(),
  /** IMO ship identification number. */
  imo: z.string().nullable().optional(),
  /** Ship category / type (Cargo, Tanker, Passenger, Fishing, Tug, Military, Pleasure, etc.). */
  ship_type: z.string().default('Unknown'),
  /** Navigational status (Under way using engine, At anchor, Moored, etc.). */
  nav_status: z.string().default('Underway'),
  /** WGS84 Longitude in decimal degrees [-180, 180]. */
  longitude: z.number().finite().min(-180).max(180),
  /** WGS84 Latitude in decimal degrees [-90, 90]. */
  latitude: z.number().finite().min(-90).max(90),
  /** Speed Over Ground (SOG) in knots. */
  sog_knots: z.number().finite().nonnegative().default(0),
  /** Course Over Ground (COG) in degrees [0, 360). */
  cog_deg: z.number().finite().min(0).max(360).default(0),
  /** True heading in degrees [0, 360). 511 indicates not available. */
  heading_deg: z.number().finite().min(0).max(511).default(511),
  /** Destination port name. */
  destination: z.string().nullable().optional(),
  /** Estimated Time of Arrival ISO timestamp. */
  eta: z.string().nullable().optional(),
  /** Last received message unix timestamp in seconds. */
  last_contact: z.number().int().nonnegative(),
});
export type ShipState = z.infer<typeof ShipState>;

/**
 * Batch response container for marine AIS feed ingestion.
 */
export const ShipBatchPayload = z.object({
  time: z.number().int().nonnegative(),
  ships: z.array(ShipState),
});
export type ShipBatchPayload = z.infer<typeof ShipBatchPayload>;

export const ShipBatch = ShipBatchPayload.extend({
  provenance: DataProvenanceSchema,
});
export type ShipBatch = z.infer<typeof ShipBatch>;
