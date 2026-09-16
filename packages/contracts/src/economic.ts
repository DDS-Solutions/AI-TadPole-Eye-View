import { z } from 'zod';
import { TenantIdSchema } from './identity.js';
import { DataProvenanceSchema } from './provenance.js';

export const ECONOMIC_SCHEMA_VERSION = 1 as const;

export const ECONOMIC_LEGAL_DISCLAIMER =
  'Economic results are decision-support signals, not guarantees, appraisals, legal advice, underwriting decisions, or automated employment decisions.' as const;

const EconomicIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[a-z0-9]+(?:[-_.:][a-z0-9]+)*$/,
    'Identifiers must be lowercase alphanumeric with allowed separators'
  );

// ============================================================================
// Discriminated Geography
// ============================================================================

export const EconomicGeographyLevelSchema = z.enum([
  'nation',
  'state',
  'county',
  'tract',
  'block_group',
  'zcta',
  'cbsa',
  'place',
  'point',
  'bounding_box',
]);
export type EconomicGeographyLevel = z.infer<typeof EconomicGeographyLevelSchema>;

export const EconomicGeographyNationSchema = z
  .object({
    level: z.literal('nation'),
    country_code: z.literal('US'),
    name: z.string().min(1).max(200).optional(),
  })
  .strict();

export const EconomicGeographyStateSchema = z
  .object({
    level: z.literal('state'),
    state_fips: z.string().regex(/^[0-9]{2}$/, 'State FIPS must be exactly 2 numeric digits'),
    state_postal: z
      .string()
      .regex(/^[A-Z]{2}$/, 'State postal code must be exactly 2 uppercase letters')
      .optional(),
    name: z.string().min(1).max(200).optional(),
  })
  .strict();

export const EconomicGeographyCountySchema = z
  .object({
    level: z.literal('county'),
    county_fips: z
      .string()
      .regex(/^[0-9]{5}$/, 'County FIPS must be exactly 5 numeric digits (SSCCC)'),
    state_fips: z
      .string()
      .regex(/^[0-9]{2}$/, 'State FIPS must be exactly 2 numeric digits')
      .optional(),
    name: z.string().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.state_fips && data.county_fips.slice(0, 2) !== data.state_fips) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['state_fips'],
        message: 'state_fips must match first 2 digits of county_fips',
      });
    }
  });

export const EconomicGeographyTractSchema = z
  .object({
    level: z.literal('tract'),
    tract_fips: z
      .string()
      .regex(/^[0-9]{11}$/, 'Census tract FIPS must be exactly 11 numeric digits (SSCCCTTTTTT)'),
    name: z.string().min(1).max(200).optional(),
  })
  .strict();

export const EconomicGeographyBlockGroupSchema = z
  .object({
    level: z.literal('block_group'),
    block_group_fips: z
      .string()
      .regex(/^[0-9]{12}$/, 'Block group FIPS must be exactly 12 numeric digits'),
    name: z.string().min(1).max(200).optional(),
  })
  .strict();

export const EconomicGeographyZctaSchema = z
  .object({
    level: z.literal('zcta'),
    zcta: z.string().regex(/^[0-9]{5}$/, 'ZCTA must be exactly 5 numeric digits'),
    name: z.string().min(1).max(200).optional(),
  })
  .strict();

export const EconomicGeographyCbsaSchema = z
  .object({
    level: z.literal('cbsa'),
    cbsa_code: z.string().regex(/^[0-9]{5}$/, 'CBSA code must be exactly 5 numeric digits'),
    name: z.string().min(1).max(200).optional(),
  })
  .strict();

export const EconomicGeographyPlaceSchema = z
  .object({
    level: z.literal('place'),
    place_fips: z
      .string()
      .regex(/^[0-9]{7}$/, 'Place FIPS must be exactly 7 numeric digits (SSPPPPP)'),
    name: z.string().min(1).max(200).optional(),
  })
  .strict();

export const EconomicGeographyPointSchema = z
  .object({
    level: z.literal('point'),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    name: z.string().min(1).max(200).optional(),
  })
  .strict();

export const EconomicGeographyBoundingBoxSchema = z
  .object({
    level: z.literal('bounding_box'),
    min_lat: z.number().finite().min(-90).max(90),
    max_lat: z.number().finite().min(-90).max(90),
    min_lon: z.number().finite().min(-180).max(180),
    max_lon: z.number().finite().min(-180).max(180),
    name: z.string().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.min_lat > b.max_lat) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['min_lat'],
        message: 'min_lat must not exceed max_lat',
      });
    }
    if (b.min_lon > b.max_lon) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['min_lon'],
        message: 'min_lon must not exceed max_lon',
      });
    }
  });

export const EconomicGeographySchema = z.discriminatedUnion('level', [
  EconomicGeographyNationSchema,
  EconomicGeographyStateSchema,
  EconomicGeographyCountySchema,
  EconomicGeographyTractSchema,
  EconomicGeographyBlockGroupSchema,
  EconomicGeographyZctaSchema,
  EconomicGeographyCbsaSchema,
  EconomicGeographyPlaceSchema,
  EconomicGeographyPointSchema,
  EconomicGeographyBoundingBoxSchema,
]);
export type EconomicGeography = z.infer<typeof EconomicGeographySchema>;

// ============================================================================
// Discriminated Economic Estimate
// ============================================================================

export const EconomicEstimateStatusSchema = z.enum([
  'available',
  'suppressed',
  'unavailable',
  'not_applicable',
]);
export type EconomicEstimateStatus = z.infer<typeof EconomicEstimateStatusSchema>;

export const EconomicEstimateAvailableSchema = z
  .object({
    status: z.literal('available'),
    value: z.number().finite(),
    margin_of_error: z.number().finite().nonnegative().nullable(),
    confidence_level: z.number().finite().gt(0).lt(1).nullable(),
    sample_size: z.number().int().positive().nullable(),
    unit: z.string().min(1).max(64),
    notes: z.string().max(1000).optional(),
  })
  .strict();
export type EconomicEstimateAvailable = z.infer<typeof EconomicEstimateAvailableSchema>;

export const SuppressionReasonSchema = z.enum([
  'disclosure_avoidance',
  'small_sample',
  'data_quality',
  'administrative',
]);
export type SuppressionReason = z.infer<typeof SuppressionReasonSchema>;

export const SuppressionBoundsSchema = z
  .object({
    lower_bound: z.number().finite().optional(),
    upper_bound: z.number().finite().optional(),
  })
  .strict()
  .superRefine((bounds, ctx) => {
    if (
      bounds.lower_bound !== undefined &&
      bounds.upper_bound !== undefined &&
      bounds.lower_bound > bounds.upper_bound
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lower_bound'],
        message: 'lower_bound must not exceed upper_bound',
      });
    }
  });
export type SuppressionBounds = z.infer<typeof SuppressionBoundsSchema>;

export const EconomicEstimateSuppressedSchema = z
  .object({
    status: z.literal('suppressed'),
    reason: SuppressionReasonSchema,
    detail: z.string().min(1).max(1000),
    bounds: SuppressionBoundsSchema.optional(),
    unit: z.string().min(1).max(64).optional(),
  })
  .strict();
export type EconomicEstimateSuppressed = z.infer<typeof EconomicEstimateSuppressedSchema>;

export const EconomicEstimateUnavailableSchema = z
  .object({
    status: z.literal('unavailable'),
    reason: z.string().min(1).max(1000),
    expected_availability: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export type EconomicEstimateUnavailable = z.infer<typeof EconomicEstimateUnavailableSchema>;

export const EconomicEstimateNotApplicableSchema = z
  .object({
    status: z.literal('not_applicable'),
    reason: z.string().min(1).max(1000),
  })
  .strict();
export type EconomicEstimateNotApplicable = z.infer<typeof EconomicEstimateNotApplicableSchema>;

export const EconomicEstimateSchema = z.discriminatedUnion('status', [
  EconomicEstimateAvailableSchema,
  EconomicEstimateSuppressedSchema,
  EconomicEstimateUnavailableSchema,
  EconomicEstimateNotApplicableSchema,
]);
export type EconomicEstimate = z.infer<typeof EconomicEstimateSchema>;

/**
 * Safely extracts a numeric value from an EconomicEstimate.
 * Returns undefined if the estimate is suppressed, unavailable, or not applicable.
 * NEVER coerces missing or suppressed data to zero.
 */
export function getNumericEstimateValue(estimate: EconomicEstimate): number | undefined {
  if (estimate.status === 'available') {
    return estimate.value;
  }
  return undefined;
}

// ============================================================================
// Evidence Disagreement
// ============================================================================

export const DisagreementSeveritySchema = z.enum(['info', 'warning', 'critical']);
export type DisagreementSeverity = z.infer<typeof DisagreementSeveritySchema>;

export const EconomicDisagreementSchema = z
  .object({
    status: z.literal('disagreement'),
    expected: z
      .object({
        source_metric: z.string().min(1).max(128),
        description: z.string().min(1).max(500),
        estimate: EconomicEstimateSchema,
      })
      .strict(),
    observed: z
      .object({
        source_metric: z.string().min(1).max(128),
        description: z.string().min(1).max(500),
        estimate: EconomicEstimateSchema,
      })
      .strict(),
    delta_description: z.string().min(1).max(1000),
    severity: DisagreementSeveritySchema,
  })
  .strict();
export type EconomicDisagreement = z.infer<typeof EconomicDisagreementSchema>;

// ============================================================================
// Economic Evidence Record & Bundle
// ============================================================================

export const EconomicEvidenceRecordSchema = z
  .object({
    evidence_id: EconomicIdentifierSchema,
    source_id: EconomicIdentifierSchema,
    metric_id: EconomicIdentifierSchema,
    variable_name: z.string().min(1).max(128),
    label: z.string().min(1).max(256),
    geography: EconomicGeographySchema,
    estimate: EconomicEstimateSchema,
    provenance: DataProvenanceSchema,
    disagreement: EconomicDisagreementSchema.optional(),
    tags: z.array(z.string().min(1).max(64)).max(32).optional(),
  })
  .strict();
export type EconomicEvidenceRecord = z.infer<typeof EconomicEvidenceRecordSchema>;

export const EconomicEvidenceBundleSchema = z
  .object({
    bundle_id: EconomicIdentifierSchema,
    tenant_id: TenantIdSchema,
    title: z.string().min(1).max(256),
    target_geography: EconomicGeographySchema,
    records: z.array(EconomicEvidenceRecordSchema).min(1).max(1000),
    created_at: z.string().datetime({ offset: true }),
    provenance: DataProvenanceSchema,
  })
  .strict();
export type EconomicEvidenceBundle = z.infer<typeof EconomicEvidenceBundleSchema>;

// ============================================================================
// BusinessContext Input & Preview
// ============================================================================

export const BusinessContextInputSchema = z
  .object({
    business_name: z.string().min(1).max(200),
    naics_code: z.string().regex(/^[0-9]{2,6}$/, 'NAICS code must be 2 to 6 numeric digits'),
    industry_title: z.string().min(1).max(200),
    target_geography: EconomicGeographySchema,
    operating_radius_meters: z.number().finite().positive().max(1_000_000).optional(),
    employee_count_estimate: z.number().int().positive().max(10_000_000).optional(),
    annual_revenue_usd_estimate: z.number().finite().positive().max(100_000_000_000).optional(),
  })
  .strict();
export type BusinessContextInput = z.infer<typeof BusinessContextInputSchema>;

export const BusinessContextPreviewSchema = z
  .object({
    schema_version: z.literal(ECONOMIC_SCHEMA_VERSION),
    preview_id: EconomicIdentifierSchema,
    tenant_id: TenantIdSchema,
    generated_at: z.string().datetime({ offset: true }),
    input: BusinessContextInputSchema,
    evidence: z.array(EconomicEvidenceRecordSchema).max(500),
    summary_estimates: z.record(z.string(), EconomicEstimateSchema),
    provenance: DataProvenanceSchema,
    warnings: z.array(z.string().min(1).max(1000)).max(100),
    disclaimer: z.literal(ECONOMIC_LEGAL_DISCLAIMER),
  })
  .strict();
export type BusinessContextPreview = z.infer<typeof BusinessContextPreviewSchema>;
