import { z } from 'zod';
import { DataProvenanceSchema } from './provenance.js';

/**
 * Normalized NASA FIRMS Thermal Hotspot / Wildfire telemetry contract.
 * Standardized across MODIS / VIIRS (SNPP / NOAA-20 / NOAA-21) data feeds.
 */
export const ThermalHotspot = z.object({
  /** Unique Hotspot identifier. */
  id: z.string().min(1),
  /** WGS84 Longitude [-180, 180]. */
  longitude: z.number().finite().min(-180).max(180),
  /** WGS84 Latitude [-90, 90]. */
  latitude: z.number().finite().min(-90).max(90),
  /** Brightness temperature (Kelvin) channel 21/22 or I-4. */
  brightness_kelvin: z.number().finite().nonnegative(),
  /** Fire Radiative Power (MW). */
  frp_mw: z.number().finite().nonnegative().default(0),
  /** Sensor / Satellite platform (VIIRS_NOAA20, VIIRS_SNPP, MODIS_AQUA, etc.). */
  satellite: z.string().default('VIIRS_NOAA20'),
  /** Detection confidence: low, nominal, high, or 0-100 percentage. */
  confidence: z.string().default('nominal'),
  /** Acquisition date (YYYY-MM-DD). */
  acq_date: z.string(),
  /** Acquisition time (HHMM UTC). */
  acq_time: z.string(),
  /** Day/Night overpass flag (D = Day, N = Night). */
  daynight: z.enum(['D', 'N']).default('D'),
});
export type ThermalHotspot = z.infer<typeof ThermalHotspot>;

/**
 * Batch container for FIRMS thermal anomaly feed.
 */
export const ThermalHotspotBatchPayload = z.object({
  time: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  hotspots: z.array(ThermalHotspot),
});
export type ThermalHotspotBatchPayload = z.infer<typeof ThermalHotspotBatchPayload>;

export const ThermalHotspotBatch = ThermalHotspotBatchPayload.extend({
  provenance: DataProvenanceSchema,
});
export type ThermalHotspotBatch = z.infer<typeof ThermalHotspotBatch>;
