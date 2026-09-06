import { COOPS_MAX_STATIONS, type CoastalStation } from '@gev/contracts';
import { z } from 'zod';

export const RawStationSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    name: z.string(),
    lat: z.union([z.string(), z.number()]),
    lng: z.union([z.string(), z.number()]),
    timezone: z.string().nullable().optional(),
  })
  .passthrough();

export const RawStationCollectionSchema = z
  .object({
    stationList: z.array(RawStationSchema).optional(),
    stations: z.array(RawStationSchema).optional(),
  })
  .passthrough();

export const RawProductResponseSchema = z
  .object({
    data: z.array(z.record(z.unknown())).optional(),
    predictions: z.array(z.record(z.unknown())).optional(),
    current_predictions: z
      .union([
        z.array(z.record(z.unknown())),
        z.object({ cp: z.array(z.record(z.unknown())) }).passthrough(),
      ])
      .optional(),
  })
  .passthrough();

const SeedStationSchema = z.object({
  metadata: RawStationSchema,
  station_types: z
    .array(z.enum(['water_level', 'tide_prediction', 'current', 'current_prediction']))
    .min(1)
    .max(4),
  datum: z
    .enum(['CRD', 'IGLD', 'LWD', 'MHHW', 'MHW', 'MTL', 'MSL', 'MLW', 'MLLW', 'NAVD', 'STND'])
    .nullable(),
  units: z.enum(['metric', 'english']),
  time_zone: z.enum(['gmt', 'lst', 'lst_ldt']),
  products: z.object({
    water_level: RawProductResponseSchema.optional(),
    predictions: RawProductResponseSchema.optional(),
    currents: RawProductResponseSchema.optional(),
    currents_predictions: RawProductResponseSchema.optional(),
  }),
});

export const CoastalSeedFixtureSchema = z.object({
  schema_version: z.literal(1),
  stations: z.array(SeedStationSchema).max(COOPS_MAX_STATIONS),
});

export type RawProductResponse = z.infer<typeof RawProductResponseSchema>;
export interface SourceStation {
  metadata: z.infer<typeof RawStationSchema>;
  station_types: CoastalStation['station_types'];
  datum: CoastalStation['datum'];
  units: CoastalStation['units'];
  time_zone: CoastalStation['time_zone'];
  products: Partial<
    Record<'water_level' | 'predictions' | 'currents' | 'currents_predictions', RawProductResponse>
  >;
}
