import { z } from 'zod';

export const DATA_PROVENANCE_SCHEMA_VERSION = 1 as const;

const ProvenanceIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9]+(?:[-_.:][a-z0-9]+)*$/, 'provenance identifiers must be lowercase literals');

const IsoTimestampSchema = z.string().datetime({ offset: true });
const UnavailableReasonSchema = z.string().min(1).max(500);

export const ObservationPeriodSchema = z
  .discriminatedUnion('status', [
    z.object({
      status: z.literal('available'),
      start: IsoTimestampSchema,
      end: IsoTimestampSchema,
    }),
    z.object({
      status: z.literal('unavailable'),
      reason: UnavailableReasonSchema,
    }),
  ])
  .superRefine((period, ctx) => {
    if (period.status === 'available' && Date.parse(period.start) > Date.parse(period.end)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end'],
        message: 'observation period start must not be after end',
      });
    }
  });
export type ObservationPeriod = z.infer<typeof ObservationPeriodSchema>;

export const DataVintageSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('available'),
    value: z.string().min(1).max(200),
  }),
  z.object({
    status: z.literal('unavailable'),
    reason: UnavailableReasonSchema,
  }),
]);
export type DataVintage = z.infer<typeof DataVintageSchema>;

export const DataProvenanceModeSchema = z.enum([
  'live',
  'cached',
  'seed',
  'download_pack',
  'unavailable',
]);
export type DataProvenanceMode = z.infer<typeof DataProvenanceModeSchema>;

export const DataProvenanceSourceModeSchema = z.enum([
  'live',
  'seed',
  'download_pack',
  'unavailable',
]);
export type DataProvenanceSourceMode = z.infer<typeof DataProvenanceSourceModeSchema>;

export const DataFreshnessSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('fresh'),
    age_seconds: z.number().finite().nonnegative(),
    fresh_for_seconds: z.number().int().positive(),
  }),
  z.object({
    status: z.literal('stale'),
    age_seconds: z.number().finite().nonnegative(),
    fresh_for_seconds: z.number().int().positive(),
  }),
  z.object({
    status: z.literal('unavailable'),
    reason: UnavailableReasonSchema,
    fresh_for_seconds: z.number().int().positive(),
  }),
]);
export type DataFreshness = z.infer<typeof DataFreshnessSchema>;

export const DataProvenanceSchema = z
  .object({
    schema_version: z.literal(DATA_PROVENANCE_SCHEMA_VERSION),
    source: z.object({
      provider_id: ProvenanceIdentifierSchema,
      feed_id: ProvenanceIdentifierSchema,
      name: z.string().min(1).max(200),
      canonical_url: z.string().url(),
    }),
    retrieved_at: IsoTimestampSchema,
    observation_period: ObservationPeriodSchema,
    vintage: DataVintageSchema,
    mode: DataProvenanceModeSchema,
    source_mode: DataProvenanceSourceModeSchema,
    license: z.object({
      id: ProvenanceIdentifierSchema,
      name: z.string().min(1).max(500),
    }),
    attribution: z.string().min(1).max(500),
    fixture_id: ProvenanceIdentifierSchema.nullable(),
    cache: z
      .object({
        cache_id: ProvenanceIdentifierSchema,
        stored_at: IsoTimestampSchema,
        origin_retrieved_at: IsoTimestampSchema,
      })
      .nullable(),
    freshness: DataFreshnessSchema,
  })
  .superRefine((provenance, ctx) => {
    if (provenance.mode === 'cached' && provenance.cache === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cache'],
        message: 'cached provenance requires cache identity',
      });
    }
    if (provenance.mode !== 'cached' && provenance.cache !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cache'],
        message: 'non-cached provenance cannot carry cache identity',
      });
    }
    if (provenance.source_mode === 'seed' && provenance.fixture_id === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fixture_id'],
        message: 'seed provenance requires fixture identity',
      });
    }
    if (provenance.source_mode !== 'seed' && provenance.fixture_id !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fixture_id'],
        message: 'only seed provenance can carry fixture identity',
      });
    }
    if (provenance.mode !== 'cached' && provenance.mode !== provenance.source_mode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_mode'],
        message: 'direct delivery mode must equal source mode',
      });
    }
  });
export type DataProvenance = z.infer<typeof DataProvenanceSchema>;

export const DataProvenanceCarrierSchema = z
  .object({ provenance: DataProvenanceSchema })
  .passthrough();
export type DataProvenanceCarrier = z.infer<typeof DataProvenanceCarrierSchema>;
