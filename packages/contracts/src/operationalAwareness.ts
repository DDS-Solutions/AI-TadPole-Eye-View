import { z } from 'zod';
import { DataProvenanceSchema } from './provenance.js';

export const OPERATIONAL_AOI_MAX_LATITUDE_SPAN = 30;
export const OPERATIONAL_AOI_MAX_LONGITUDE_SPAN = 60;
export const NWS_ALERT_MAX_RECORDS = 500;
export const AWC_PRODUCT_MAX_RECORDS = 400;
export const NHC_INDEX_MAX_ITEMS = 256;
export const NHC_KMZ_MAX_ENTRIES = 32;
export const NHC_KMZ_MAX_EXPANDED_BYTES = 20_971_520;
export const COOPS_MAX_STATIONS = 100;
export const COOPS_MAX_RECORDS = 10_000;

const IsoTimestampSchema = z.string().datetime({ offset: true });
const NormalizedUtcTimestampSchema = z
  .string()
  .regex(
    /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/
  );
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

const OperationalPointSchema = z.object({ longitude: LongitudeSchema, latitude: LatitudeSchema });
const OperationalLineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(CoordinateSchema).min(2).max(4096),
});

export const TropicalCycloneBasinSchema = z.enum([
  'atlantic',
  'eastern_pacific',
  'central_pacific',
]);
export type TropicalCycloneBasin = z.infer<typeof TropicalCycloneBasinSchema>;

export const TropicalCycloneProductSchema = z.enum(['track', 'cone', 'watch_warning']);
export type TropicalCycloneProduct = z.infer<typeof TropicalCycloneProductSchema>;

export const TropicalForecastPointSchema = z.object({
  position: OperationalPointSchema,
  valid_at: IsoTimestampSchema.nullable(),
});
export type TropicalForecastPoint = z.infer<typeof TropicalForecastPointSchema>;

export const TropicalCycloneAdvisorySchema = z
  .object({
    id: z.string().min(1).max(256),
    storm_id: z.string().regex(/^[A-Z]{2}\d{6}$/),
    storm_name: z.string().min(1).max(128),
    storm_type: z.string().min(1).max(64),
    basin: TropicalCycloneBasinSchema,
    advisory_number: z.string().regex(/^\d{1,3}[A-Z]?$/),
    product: TropicalCycloneProductSchema,
    issued_at: IsoTimestampSchema,
    observation_time: IsoTimestampSchema,
    valid_from: IsoTimestampSchema,
    valid_to: IsoTimestampSchema,
    geometry: z.union([
      OperationalLineStringSchema,
      OperationalPolygonSchema,
      OperationalMultiPolygonSchema,
    ]),
    forecast_points: z.array(TropicalForecastPointSchema).max(128),
    warning_type: z.string().min(1).max(128).nullable(),
  })
  .superRefine((value, ctx) => {
    if (Date.parse(value.valid_to) <= Date.parse(value.valid_from)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['valid_to'],
        message: 'Advisory validity must be ordered',
      });
    }
    if (value.product === 'cone' && value.geometry.type === 'LineString') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['geometry'],
        message: 'Cone geometry must be polygonal',
      });
    }
    if (value.product === 'track' && value.geometry.type !== 'LineString') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['geometry'],
        message: 'Track geometry must be a line',
      });
    }
    if (value.product === 'watch_warning' && !value.warning_type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['warning_type'],
        message: 'Watch/warning type is required',
      });
    }
  });
export type TropicalCycloneAdvisory = z.infer<typeof TropicalCycloneAdvisorySchema>;

const TropicalCycloneResponseBaseSchema = z.object({
  retrieved_at: IsoTimestampSchema,
  count: z.number().int().nonnegative().max(NHC_INDEX_MAX_ITEMS),
  advisories: z.array(TropicalCycloneAdvisorySchema).max(NHC_INDEX_MAX_ITEMS),
  usage_notice: z.string().min(1).max(512),
});
export const TropicalCycloneResponsePayloadSchema = TropicalCycloneResponseBaseSchema.refine(
  (value) => value.count === value.advisories.length,
  'Tropical cyclone count must match records'
);
export const TropicalCycloneResponseSchema = TropicalCycloneResponseBaseSchema.extend({
  provenance: DataProvenanceSchema,
}).refine(
  (value) => value.count === value.advisories.length,
  'Tropical cyclone count must match records'
);
export type TropicalCycloneResponse = z.infer<typeof TropicalCycloneResponseSchema>;

export const NHC_USAGE_NOTICE =
  'NOAA NHC/CPHC experimental GIS data; not for navigation or life-safety decisions.';

export const CoastalValueSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('available'), value: z.number().finite() }),
  z.object({ status: z.literal('unavailable'), reason: z.string().min(1).max(256) }),
]);
export type CoastalValue = z.infer<typeof CoastalValueSchema>;

export const CoastalWaterLevelObservationSchema = z.object({
  observed_at: NormalizedUtcTimestampSchema,
  value: CoastalValueSchema,
  sigma: z.number().finite().nullable(),
  quality: z.enum(['preliminary', 'verified', 'unknown']),
  flags: z.array(z.string().max(32)).max(8),
});
export type CoastalWaterLevelObservation = z.infer<typeof CoastalWaterLevelObservationSchema>;

export const CoastalTidePredictionSchema = z.object({
  valid_at: NormalizedUtcTimestampSchema,
  value: CoastalValueSchema,
  tide_type: z.enum(['HH', 'H', 'L', 'LL']).nullable(),
});
export type CoastalTidePrediction = z.infer<typeof CoastalTidePredictionSchema>;

export const CoastalCurrentObservationSchema = z.object({
  observed_at: NormalizedUtcTimestampSchema,
  speed: CoastalValueSchema,
  direction_deg: CoastalValueSchema,
  bin: z.number().int().nonnegative().nullable(),
  quality_flags: z.array(z.string().max(64)).max(8),
});
export type CoastalCurrentObservation = z.infer<typeof CoastalCurrentObservationSchema>;

export const CoastalCurrentPredictionSchema = z.object({
  valid_at: NormalizedUtcTimestampSchema,
  speed: CoastalValueSchema,
  direction_deg: CoastalValueSchema,
  velocity_major: CoastalValueSchema,
  mean_ebb_direction_deg: CoastalValueSchema,
  mean_flood_direction_deg: CoastalValueSchema,
  bin: z.number().int().nonnegative().nullable(),
  depth: CoastalValueSchema,
});
export type CoastalCurrentPrediction = z.infer<typeof CoastalCurrentPredictionSchema>;

export const CoastalStationSchema = z.object({
  station_id: z.string().regex(/^[A-Za-z0-9]{4,16}$/),
  name: z.string().min(1).max(200),
  position: OperationalPointSchema,
  station_types: z
    .array(z.enum(['water_level', 'tide_prediction', 'current', 'current_prediction']))
    .min(1)
    .max(4),
  datum: z
    .enum(['CRD', 'IGLD', 'LWD', 'MHHW', 'MHW', 'MTL', 'MSL', 'MLW', 'MLLW', 'NAVD', 'STND'])
    .nullable(),
  units: z.enum(['metric', 'english']),
  time_zone: z.enum(['gmt', 'lst', 'lst_ldt']),
  station_time_zone_name: z.string().min(1).max(64).nullable(),
  metadata_retrieved_at: NormalizedUtcTimestampSchema,
  water_level_observations: z.array(CoastalWaterLevelObservationSchema).max(COOPS_MAX_RECORDS),
  tide_predictions: z.array(CoastalTidePredictionSchema).max(COOPS_MAX_RECORDS),
  current_observations: z.array(CoastalCurrentObservationSchema).max(COOPS_MAX_RECORDS),
  current_predictions: z.array(CoastalCurrentPredictionSchema).max(COOPS_MAX_RECORDS),
});
export type CoastalStation = z.infer<typeof CoastalStationSchema>;

function coastalRecordCount(stations: readonly CoastalStation[]): number {
  return stations.reduce(
    (count, station) =>
      count +
      station.water_level_observations.length +
      station.tide_predictions.length +
      station.current_observations.length +
      station.current_predictions.length,
    0
  );
}

const CoastalConditionsBaseSchema = z
  .object({
    retrieved_at: NormalizedUtcTimestampSchema,
    count: z.number().int().nonnegative().max(COOPS_MAX_STATIONS),
    record_count: z.number().int().nonnegative().max(COOPS_MAX_RECORDS),
    stations: z.array(CoastalStationSchema).max(COOPS_MAX_STATIONS),
    usage_notice: z.string().min(1).max(512),
    water_level_provenance: DataProvenanceSchema,
    current_provenance: DataProvenanceSchema,
  })
  .superRefine((value, ctx) => {
    if (value.count !== value.stations.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['count'],
        message: 'Coastal station count must match records',
      });
    }
    if (value.record_count !== coastalRecordCount(value.stations)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['record_count'],
        message: 'Coastal record count must match observations and predictions',
      });
    }
  });
export const CoastalConditionsResponsePayloadSchema = CoastalConditionsBaseSchema;
export const CoastalConditionsResponseSchema = CoastalConditionsBaseSchema.and(
  z.object({ provenance: DataProvenanceSchema })
);
export type CoastalConditionsResponse = z.infer<typeof CoastalConditionsResponseSchema>;

export const COOPS_USAGE_NOTICE =
  'NOAA CO-OPS observations may be preliminary and predictions are guidance; not for navigation.';
