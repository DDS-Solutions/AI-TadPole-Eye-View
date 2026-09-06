import { z } from 'zod';
import { DataProvenanceSchema } from './provenance.js';

export const OPERATIONAL_AOI_MAX_LATITUDE_SPAN = 30;
export const OPERATIONAL_AOI_MAX_LONGITUDE_SPAN = 60;
export const NWS_ALERT_MAX_RECORDS = 500;
export const AWC_PRODUCT_MAX_RECORDS = 400;

const IsoTimestampSchema = z.string().datetime({ offset: true });
const LongitudeSchema = z.number().finite().min(-180).max(180);
const LatitudeSchema = z.number().finite().min(-90).max(90);
const CoordinateSchema = z.tuple([LongitudeSchema, LatitudeSchema]);

export const OperationalAoiSchema = z
  .object({
    min_lat: LatitudeSchema,
    max_lat: LatitudeSchema,
    min_lon: LongitudeSchema,
    max_lon: LongitudeSchema,
  })
  .superRefine((aoi, ctx) => {
    if (aoi.min_lat > aoi.max_lat) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['max_lat'],
        message: 'AOI latitude bounds are reversed',
      });
    }
    if (aoi.min_lon > aoi.max_lon) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['max_lon'],
        message: 'ANTIMERIDIAN_UNSUPPORTED',
      });
    }
    if (aoi.max_lat - aoi.min_lat > OPERATIONAL_AOI_MAX_LATITUDE_SPAN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['max_lat'],
        message: 'AOI latitude span exceeds 30 degrees',
      });
    }
    if (aoi.max_lon - aoi.min_lon > OPERATIONAL_AOI_MAX_LONGITUDE_SPAN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['max_lon'],
        message: 'AOI longitude span exceeds 60 degrees',
      });
    }
  });
export type OperationalAoi = z.infer<typeof OperationalAoiSchema>;

const LinearRingSchema = z
  .array(CoordinateSchema)
  .min(4)
  .max(4096)
  .superRefine((ring, ctx) => {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first?.[0] !== last?.[0] || first?.[1] !== last?.[1]) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Polygon rings must be closed' });
    }
  });

export const OperationalPolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(LinearRingSchema).min(1).max(16),
});
export const OperationalMultiPolygonSchema = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(LinearRingSchema).min(1).max(16)).min(1).max(64),
});
export const OperationalAreaGeometrySchema = z.discriminatedUnion('type', [
  OperationalPolygonSchema,
  OperationalMultiPolygonSchema,
]);
export type OperationalAreaGeometry = z.infer<typeof OperationalAreaGeometrySchema>;

export const SolarLightBandSchema = z.enum([
  'day',
  'civil_twilight',
  'nautical_twilight',
  'astronomical_twilight',
  'night',
]);
export type SolarLightBand = z.infer<typeof SolarLightBandSchema>;

export const SolarBoundarySchema = z.object({
  band: z.enum(['sunset', 'civil', 'nautical', 'astronomical']),
  solar_altitude_deg: z.union([z.literal(0), z.literal(-6), z.literal(-12), z.literal(-18)]),
  coordinates: z
    .array(z.object({ longitude: LongitudeSchema, latitude: LatitudeSchema }))
    .min(73)
    .max(721),
});
export type SolarBoundary = z.infer<typeof SolarBoundarySchema>;

export const SolarContextPayloadSchema = z.object({
  computed_at: IsoTimestampSchema,
  subsolar_point: z.object({ longitude: LongitudeSchema, latitude: LatitudeSchema }),
  boundaries: z.array(SolarBoundarySchema).length(4),
  north_pole: SolarLightBandSchema,
  south_pole: SolarLightBandSchema,
});
export type SolarContextPayload = z.infer<typeof SolarContextPayloadSchema>;

export const SolarContextResponseSchema = SolarContextPayloadSchema.extend({
  provenance: DataProvenanceSchema,
});
export type SolarContextResponse = z.infer<typeof SolarContextResponseSchema>;

export const NwsAlertReferenceSchema = z.object({
  sender: z.string().min(1).max(256),
  identifier: z.string().min(1).max(512),
  sent: IsoTimestampSchema,
});
export type NwsAlertReference = z.infer<typeof NwsAlertReferenceSchema>;

export const NwsAlertSchema = z.object({
  id: z.string().min(1).max(512),
  event: z.string().min(1).max(200),
  headline: z.string().min(1).max(500),
  area_description: z.string().min(1).max(1000),
  severity: z.enum(['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown']),
  certainty: z.enum(['Observed', 'Likely', 'Possible', 'Unlikely', 'Unknown']),
  urgency: z.enum(['Immediate', 'Expected', 'Future', 'Past', 'Unknown']),
  status: z.enum(['Actual', 'Exercise', 'System', 'Test', 'Draft']),
  message_type: z.enum(['Alert', 'Update', 'Cancel', 'Ack', 'Error']),
  sent: IsoTimestampSchema,
  effective: IsoTimestampSchema,
  onset: IsoTimestampSchema.nullable(),
  expires: IsoTimestampSchema,
  ends: IsoTimestampSchema.nullable(),
  references: z.array(NwsAlertReferenceSchema).max(64),
  geometry: OperationalAreaGeometrySchema,
});
export type NwsAlert = z.infer<typeof NwsAlertSchema>;

const NwsAlertCollectionBaseSchema = z.object({
  generated_at: IsoTimestampSchema,
  count: z.number().int().nonnegative().max(NWS_ALERT_MAX_RECORDS),
  alerts: z.array(NwsAlertSchema).max(NWS_ALERT_MAX_RECORDS),
});
export const NwsAlertCollectionPayloadSchema = NwsAlertCollectionBaseSchema.refine(
  (value) => value.count === value.alerts.length,
  'NWS alert count must match records'
);

export const NwsAlertCollectionSchema = NwsAlertCollectionBaseSchema.extend({
  provenance: DataProvenanceSchema,
}).refine((value) => value.count === value.alerts.length, 'NWS alert count must match records');
export type NwsAlertCollection = z.infer<typeof NwsAlertCollectionSchema>;

const AviationPointSchema = z.object({ longitude: LongitudeSchema, latitude: LatitudeSchema });

export const AviationMetarSchema = z.object({
  id: z.string().min(1).max(64),
  station_id: z.string().min(1).max(16),
  position: AviationPointSchema,
  observation_time: IsoTimestampSchema,
  raw_text: z.string().min(1).max(4096),
  flight_category: z.enum(['VFR', 'MVFR', 'IFR', 'LIFR', 'UNKNOWN']),
  temperature_c: z.number().finite().nullable(),
  wind_speed_kt: z.number().finite().nonnegative().nullable(),
});
export type AviationMetar = z.infer<typeof AviationMetarSchema>;

export const AviationTafSchema = z.object({
  id: z.string().min(1).max(64),
  station_id: z.string().min(1).max(16),
  position: AviationPointSchema,
  issue_time: IsoTimestampSchema,
  valid_from: IsoTimestampSchema,
  valid_to: IsoTimestampSchema,
  raw_text: z.string().min(1).max(8192),
});
export type AviationTaf = z.infer<typeof AviationTafSchema>;

export const AviationSigmetSchema = z.object({
  id: z.string().min(1).max(128),
  hazard: z.string().min(1).max(128),
  issue_time: IsoTimestampSchema,
  valid_from: IsoTimestampSchema,
  valid_to: IsoTimestampSchema,
  raw_text: z.string().min(1).max(8192),
  geometry: OperationalAreaGeometrySchema,
});
export type AviationSigmet = z.infer<typeof AviationSigmetSchema>;

function productCollection<T extends z.ZodTypeAny>(item: T) {
  return z
    .object({
      count: z.number().int().nonnegative().max(AWC_PRODUCT_MAX_RECORDS),
      items: z.array(item).max(AWC_PRODUCT_MAX_RECORDS),
      provenance: DataProvenanceSchema,
    })
    .refine((value) => value.count === value.items.length, 'AWC product count must match records');
}

export const AviationWeatherResponseSchema = z.object({
  retrieved_at: IsoTimestampSchema,
  metars: productCollection(AviationMetarSchema),
  tafs: productCollection(AviationTafSchema),
  sigmets: productCollection(AviationSigmetSchema),
  provenance: DataProvenanceSchema,
});
export type AviationWeatherResponse = z.infer<typeof AviationWeatherResponseSchema>;

export type AviationWeatherItem =
  | ({ product: 'metar' } & AviationMetar)
  | ({ product: 'taf' } & AviationTaf)
  | ({ product: 'sigmet' } & AviationSigmet);
