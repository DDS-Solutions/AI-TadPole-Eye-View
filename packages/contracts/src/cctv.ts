import { z } from 'zod';
import { DataProvenanceSchema } from './provenance.js';

export const CctvStreamType = z.enum(['hls', 'mjpeg', 'image', 'mp4']);
export type CctvStreamType = z.infer<typeof CctvStreamType>;

export const CctvStatus = z.enum(['online', 'offline', 'degraded']);
export type CctvStatus = z.infer<typeof CctvStatus>;

/**
 * CCTV / Traffic Camera contract.
 */
export const CctvCamera = z.object({
  /** Unique camera identifier (e.g. "caltrans-d4-baybridge-west"). */
  id: z.string().min(1),
  /** Human-readable camera location/name. */
  name: z.string().min(1),
  /** Managing agency (e.g. "Caltrans District 4", "NYCDOT", "TfL"). */
  agency: z.string().default('Unknown Agency'),
  /** WGS84 Longitude [-180, 180]. */
  longitude: z.number().finite().min(-180).max(180),
  /** WGS84 Latitude [-90, 90]. */
  latitude: z.number().finite().min(-90).max(90),
  /** Text description of location. */
  location_name: z.string().default(''),
  /** Stream / media delivery type. */
  stream_type: CctvStreamType.default('image'),
  /** Direct upstream live video/stream URL. */
  stream_url: z.string().url().optional(),
  /** Upstream static image snapshot URL. */
  snapshot_url: z.string().url(),
  /** Current operating status. */
  status: CctvStatus.default('online'),
  /** Snapshot refresh interval in seconds (e.g. 5-30s). */
  refresh_interval_sec: z.number().int().positive().default(10),
  /** Last successful snapshot check timestamp. */
  last_updated: z.number().int().nonnegative().optional(),
});
export type CctvCamera = z.infer<typeof CctvCamera>;

/**
 * Collection container for CCTV camera catalog.
 */
export const CctvCatalogPayload = z.object({
  time: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  cameras: z.array(CctvCamera),
});
export type CctvCatalogPayload = z.infer<typeof CctvCatalogPayload>;

export const CctvCatalog = CctvCatalogPayload.extend({
  provenance: DataProvenanceSchema,
});
export type CctvCatalog = z.infer<typeof CctvCatalog>;
