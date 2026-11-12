import { z } from 'zod';
import { EconomicEstimateSchema, EconomicGeographySchema } from './economic.js';
import { DataProvenanceSchema } from './provenance.js';

// ============================================================================
// DOT/BTS Transportation Accessibility Context Contracts
// (PLAN.md §10 Task 11.4 & ADR 0065)
// ============================================================================

export const DOT_BTS_SCHEMA_VERSION = 1 as const;
export const DOT_BTS_DEFAULT_VINTAGE =
  'DOT/BTS National Transportation Atlas & Transit Access (2024)' as const;
export const DOT_BTS_BASE_URL = 'https://data.bts.gov/resource' as const;
export const DOT_BTS_DATA_HORIZON = 'structural_infrastructure_benchmark' as const;

export const DOT_BTS_SCREENING_DISCLAIMER =
  'DOT/BTS transportation and accessibility metrics provide structural infrastructure screening signals only (highway proximity, transit station access, freight corridor connectivity, and commute burden). They do not replace licensed traffic impact studies, ADA compliance audits, or site engineering surveys.' as const;

export const DotBtsAccessibilityTierSchema = z.enum([
  'high_access',
  'moderate_access',
  'limited_access',
  'auto_dependent',
  'unavailable',
]);
export type DotBtsAccessibilityTier = z.infer<typeof DotBtsAccessibilityTierSchema>;

export const DotBtsFreightCorridorExposureSchema = z.enum([
  'primary_freight_corridor',
  'secondary_arterial',
  'local_access',
  'unavailable',
]);
export type DotBtsFreightCorridorExposure = z.infer<typeof DotBtsFreightCorridorExposureSchema>;

export const DotBtsAccessibilityRecordSchema = z
  .object({
    geography: EconomicGeographySchema,
    centroid: z
      .object({
        latitude: z.number().finite().min(-90).max(90),
        longitude: z.number().finite().min(-180).max(180),
      })
      .strict()
      .optional(),
    nearest_interstate_km: EconomicEstimateSchema,
    nearest_transit_stop_km: EconomicEstimateSchema,
    transit_stops_within_1km: EconomicEstimateSchema,
    freight_corridor_distance_km: EconomicEstimateSchema,
    walkable_road_density_km_per_sqkm: EconomicEstimateSchema,
    commute_mean_minutes: EconomicEstimateSchema,
    accessibility_tier: DotBtsAccessibilityTierSchema,
    freight_exposure: DotBtsFreightCorridorExposureSchema,
    is_covered: z.boolean(),
    data_horizon: z.literal(DOT_BTS_DATA_HORIZON),
    provenance: DataProvenanceSchema,
    advisory_disclaimer: z.literal(DOT_BTS_SCREENING_DISCLAIMER),
  })
  .strict()
  .superRefine((rec, ctx) => {
    if (!rec.is_covered) {
      const estimates = [
        ['nearest_interstate_km', rec.nearest_interstate_km],
        ['nearest_transit_stop_km', rec.nearest_transit_stop_km],
        ['transit_stops_within_1km', rec.transit_stops_within_1km],
        ['freight_corridor_distance_km', rec.freight_corridor_distance_km],
        ['walkable_road_density_km_per_sqkm', rec.walkable_road_density_km_per_sqkm],
        ['commute_mean_minutes', rec.commute_mean_minutes],
      ] as const;
      for (const [name, est] of estimates) {
        if (est.status === 'available') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [name, 'status'],
            message: `Non-coercion law: uncovered DOT/BTS ${name} must not evaluate to available`,
          });
        }
      }
      if (rec.accessibility_tier !== 'unavailable') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['accessibility_tier'],
          message: 'Uncovered DOT/BTS record must set accessibility_tier to unavailable',
        });
      }
      if (rec.freight_exposure !== 'unavailable') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['freight_exposure'],
          message: 'Uncovered DOT/BTS record must set freight_exposure to unavailable',
        });
      }
    }
  });
export type DotBtsAccessibilityRecord = z.infer<typeof DotBtsAccessibilityRecordSchema>;

export const DotBtsQuerySchema = z
  .object({
    geography: EconomicGeographySchema,
    radius_km: z.number().finite().positive().max(250).default(25),
    dataset_id: z
      .string()
      .regex(/^[a-z0-9]{4}-[a-z0-9]{4}$/, 'Socrata dataset ID must follow xxxx-xxxx format')
      .optional(),
  })
  .strict();
export type DotBtsQuery = z.input<typeof DotBtsQuerySchema>;
export type ParsedDotBtsQuery = z.infer<typeof DotBtsQuerySchema>;

export const DotBtsQueryResultSchema = z
  .object({
    geography: EconomicGeographySchema,
    data_horizon: z.literal(DOT_BTS_DATA_HORIZON),
    records: z.array(DotBtsAccessibilityRecordSchema),
    provenance: DataProvenanceSchema,
    advisory_disclaimer: z.literal(DOT_BTS_SCREENING_DISCLAIMER),
  })
  .strict();
export type DotBtsQueryResult = z.infer<typeof DotBtsQueryResultSchema>;

export const RawDotBtsRowSchema = z
  .object({
    geoid: z.string().optional(),
    county_fips: z.string().optional(),
    state_fips: z.string().optional(),
    nearest_interstate_km: z.union([z.number(), z.string()]).nullable().optional(),
    nearest_transit_stop_km: z.union([z.number(), z.string()]).nullable().optional(),
    transit_stops_within_1km: z.union([z.number(), z.string()]).nullable().optional(),
    freight_corridor_distance_km: z.union([z.number(), z.string()]).nullable().optional(),
    walkable_road_density_km_per_sqkm: z.union([z.number(), z.string()]).nullable().optional(),
    commute_mean_minutes: z.union([z.number(), z.string()]).nullable().optional(),
    latitude: z.union([z.number(), z.string()]).nullable().optional(),
    longitude: z.union([z.number(), z.string()]).nullable().optional(),
  })
  .passthrough();
export type RawDotBtsRow = z.infer<typeof RawDotBtsRowSchema>;

export const DotBtsFixtureDatasetSchema = z
  .object({
    schema_version: z.literal(DOT_BTS_SCHEMA_VERSION),
    fixture_id: z.literal('dot-bts-synthetic-v1'),
    source_id: z.literal('dot-bts-access'),
    title: z.string().min(1).max(256),
    description: z.string().min(1).max(1000),
    data_horizon: z.literal(DOT_BTS_DATA_HORIZON),
    provenance: DataProvenanceSchema,
    records: z.array(DotBtsAccessibilityRecordSchema).min(1),
  })
  .strict();
export type DotBtsFixtureDataset = z.infer<typeof DotBtsFixtureDatasetSchema>;
