import { z } from 'zod';
import { DataProvenanceSchema } from './provenance.js';

export const RadarFrame = z.object({
  path: z.string().min(1),
  time: z.number().int().nonnegative(),
});
export type RadarFrame = z.infer<typeof RadarFrame>;

export const WeatherStation = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  longitude: z.number().finite().min(-180).max(180),
  latitude: z.number().finite().min(-90).max(90),
  temp_c: z.number().finite(),
  humidity_pct: z.number().finite().min(0).max(100),
  wind_speed_kmh: z.number().finite().nonnegative(),
  wind_direction_deg: z.number().finite().min(0).max(360),
  condition: z.string().default('Clear'),
});
export type WeatherStation = z.infer<typeof WeatherStation>;

export const WeatherCollectionPayload = z.object({
  time: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  radar_frames: z.array(RadarFrame).default([]),
  radar_tile_template: z
    .string()
    .default('https://tilecache.rainviewer.com{path}/256/{z}/{x}/{y}/2/1_1.png'),
  stations: z.array(WeatherStation).default([]),
});
export type WeatherCollectionPayload = z.infer<typeof WeatherCollectionPayload>;

export const WeatherCollection = WeatherCollectionPayload.extend({
  provenance: DataProvenanceSchema,
});
export type WeatherCollection = z.infer<typeof WeatherCollection>;
