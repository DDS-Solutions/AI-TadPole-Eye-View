import { z } from 'zod';
import { DataProvenanceSchema } from './provenance.js';

export const RadioCategory = z.enum(['atc', 'marine', 'emergency', 'broadcast']);
export type RadioCategory = z.infer<typeof RadioCategory>;

export const RadioStreamStatus = z.enum(['online', 'offline', 'degraded']);
export type RadioStreamStatus = z.infer<typeof RadioStreamStatus>;

export const RadioAudioFormat = z.enum(['mp3', 'aac', 'ogg']);
export type RadioAudioFormat = z.infer<typeof RadioAudioFormat>;

/**
 * Normalized Radio Station and ATC/Marine Frequency contract.
 */
export const RadioStation = z.object({
  /** Unique Station identifier (e.g. "ksfo-tower-120.5"). */
  id: z.string().min(1),
  /** Human readable station name (e.g. "San Francisco International (KSFO) Tower"). */
  name: z.string().min(1),
  /** Category of radio stream. */
  category: RadioCategory.default('atc'),
  /** Radio frequency in MHz (optional, e.g. 120.5 for KSFO Tower, 156.8 for Marine Ch 16). */
  frequency_mhz: z.number().finite().positive().optional(),
  /** Upstream direct audio stream URL. */
  stream_url: z.string().url(),
  /** WGS84 Longitude [-180, 180]. */
  longitude: z.number().finite().min(-180).max(180),
  /** WGS84 Latitude [-90, 90]. */
  latitude: z.number().finite().min(-90).max(90),
  /** Geographic location descriptor (e.g. "San Francisco, CA, USA"). */
  location_name: z.string().default('Unknown Location'),
  /** Current stream availability status. */
  status: RadioStreamStatus.default('online'),
  /** Audio stream bitrate in kbps. */
  bitrate_kbps: z.number().int().positive().default(64),
  /** Stream audio container format. */
  format: RadioAudioFormat.default('mp3'),
  /** Last health check timestamp in seconds. */
  last_checked: z.number().int().nonnegative().optional(),
});
export type RadioStation = z.infer<typeof RadioStation>;

/**
 * Collection container for radio catalog.
 */
export const RadioCatalogPayload = z.object({
  time: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  stations: z.array(RadioStation),
});
export type RadioCatalogPayload = z.infer<typeof RadioCatalogPayload>;

export const RadioCatalog = RadioCatalogPayload.extend({
  provenance: DataProvenanceSchema,
});
export type RadioCatalog = z.infer<typeof RadioCatalog>;
