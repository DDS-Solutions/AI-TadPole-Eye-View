import { z } from 'zod';
import { EconomicEstimateSchema, EconomicGeographySchema } from './economic.js';
import { DataProvenanceSchema } from './provenance.js';

// ============================================================================
// FEMA NRI & NFHL Contracts (PLAN.md §10 Task 11.1 & ADR 0062)
// ============================================================================

export const FEMA_NRI_SCHEMA_VERSION = 1 as const;
export const FEMA_NFHL_SCHEMA_VERSION = 1 as const;

export const FEMA_NRI_DEFAULT_VINTAGE = 'November 2023' as const;
export const FEMA_NFHL_DEFAULT_VINTAGE = 'NFHL Status Active (September 2024)' as const;

export const FEMA_NRI_SCREENING_DISCLAIMER =
  'FEMA National Risk Index (NRI) scores and ratings are relative risk indicators intended for planning, hazard mitigation, and preliminary screening. They do not replace site-specific geotechnical, structural, or hydrological studies, and must not be used as sole evidence for underwriting, property rating, or regulatory compliance.' as const;

export const FEMA_NFHL_ADVISORY_DISCLAIMER =
  'FEMA National Flood Hazard Layer (NFHL) data is provided for geospatial screening and flood hazard identification only. NFHL zone classifications do not constitute a formal Letter of Map Amendment (LOMA), Letter of Map Revision (LOMR), or official Flood Determination. Commercial underwriting, insurance mandates, or building permitting require certified Flood Determinations and Elevation Certificates issued by licensed professionals.' as const;

// ============================================================================
// FEMA National Risk Index (NRI) Types & Schemas
// ============================================================================

export const FemaNriRiskRatingSchema = z.enum([
  'Very Low',
  'Relatively Low',
  'Relatively Moderate',
  'Relatively High',
  'Very High',
  'Not Applicable',
  'Insufficient Data',
]);
export type FemaNriRiskRating = z.infer<typeof FemaNriRiskRatingSchema>;

export const FemaNriHazardTypeSchema = z.enum([
  'avalanche',
  'coastal_flooding',
  'cold_wave',
  'drought',
  'earthquake',
  'hail',
  'heat_wave',
  'hurricane',
  'ice_storm',
  'landslide',
  'lightning',
  'riverine_flooding',
  'strong_wind',
  'tornado',
  'tsunami',
  'volcanic_activity',
  'wildfire',
  'winter_weather',
]);
export type FemaNriHazardType = z.infer<typeof FemaNriHazardTypeSchema>;

export const FemaNriVariableIdSchema = z.enum([
  // Composite metrics
  'RISK_SCORE',
  'RISK_RATNG',
  'RISK_NPCTL',
  'RISK_SPCTL',
  // Expected Annual Loss (EAL)
  'EAL_VALT',
  'EAL_VALB',
  'EAL_VALP',
  'EAL_VALA',
  'EAL_SCORE',
  'EAL_RATNG',
  // Social Vulnerability (SoVI)
  'SOVI_SCORE',
  'SOVI_RATNG',
  'SOVI_NPCTL',
  // Community Resilience (BRIC)
  'RESL_SCORE',
  'RESL_RATNG',
  'RESL_NPCTL',
  // Exposure metrics
  'POPULATION',
  'BUILDVALUE',
  'AGRIVALUE',
  // Key individual hazard scores
  'RFLD_RISKS',
  'RFLD_RISKR',
  'RFLD_EALT',
  'CFLD_RISKS',
  'CFLD_RISKR',
  'CFLD_EALT',
  'HRCN_RISKS',
  'HRCN_RISKR',
  'HRCN_EALT',
  'TRND_RISKS',
  'TRND_RISKR',
  'TRND_EALT',
  'WDFR_RISKS',
  'WDFR_RISKR',
  'WDFR_EALT',
  'ERQK_RISKS',
  'ERQK_RISKR',
  'ERQK_EALT',
  'SWND_RISKS',
  'SWND_RISKR',
  'SWND_EALT',
  'WNTW_RISKS',
  'WNTW_RISKR',
  'WNTW_EALT',
  'HWAV_RISKS',
  'HWAV_RISKR',
  'HWAV_EALT',
  'HAIL_RISKS',
  'HAIL_RISKR',
  'HAIL_EALT',
  'DRGT_RISKS',
  'DRGT_RISKR',
  'DRGT_EALT',
  'LNDS_RISKS',
  'LNDS_RISKR',
  'LNDS_EALT',
  'LTNG_RISKS',
  'LTNG_RISKR',
  'LTNG_EALT',
  'ISTM_RISKS',
  'ISTM_RISKR',
  'ISTM_EALT',
  'TSUN_RISKS',
  'TSUN_RISKR',
  'TSUN_EALT',
  'AVAL_RISKS',
  'AVAL_RISKR',
  'AVAL_EALT',
  'CWAV_RISKS',
  'CWAV_RISKR',
  'CWAV_EALT',
  'VLCN_RISKS',
  'VLCN_RISKR',
  'VLCN_EALT',
]);
export type FemaNriVariableId = z.infer<typeof FemaNriVariableIdSchema>;

export const FemaNriUnitSchema = z.enum([
  'index_score',
  'percentile',
  'USD',
  'count',
  'categorical_rating',
]);
export type FemaNriUnit = z.infer<typeof FemaNriUnitSchema>;

export const FemaNriVariableCategorySchema = z.enum([
  'composite_risk',
  'expected_annual_loss',
  'social_vulnerability',
  'community_resilience',
  'exposure',
  'hazard_risk',
]);
export type FemaNriVariableCategory = z.infer<typeof FemaNriVariableCategorySchema>;

export const FemaNriVariableDefinitionSchema = z
  .object({
    variable_id: FemaNriVariableIdSchema,
    metric_id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9-]+$/, 'metric_id must be lowercase alphanumeric with hyphens'),
    label: z.string().min(1).max(256),
    description: z.string().min(1).max(1000),
    unit: FemaNriUnitSchema,
    category: FemaNriVariableCategorySchema,
    hazard_type: FemaNriHazardTypeSchema.optional(),
    supported_geographies: z.array(z.string().min(1).max(32)).min(1),
    tags: z.array(z.string().min(1).max(64)).max(16),
  })
  .strict();
export type FemaNriVariableDefinition = z.infer<typeof FemaNriVariableDefinitionSchema>;

export const FemaNriVariableDictionarySchema = z
  .object({
    schema_version: z.literal(FEMA_NRI_SCHEMA_VERSION),
    version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Version must follow semver X.Y.Z'),
    program: z.literal('fema_nri'),
    screening_disclaimer: z.literal(FEMA_NRI_SCREENING_DISCLAIMER),
    vintages_supported: z.array(z.string().min(4).max(64)).min(1),
    variables: z.record(z.string(), FemaNriVariableDefinitionSchema),
  })
  .strict();
export type FemaNriVariableDictionary = z.infer<typeof FemaNriVariableDictionarySchema>;

export const FemaNriQueryGeographySchema = EconomicGeographySchema.superRefine((geo, ctx) => {
  const allowedLevels = ['county', 'tract', 'state'];
  if (!allowedLevels.includes(geo.level)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['level'],
      message: `FEMA NRI queries support geographies: ${allowedLevels.join(', ')}. Received '${geo.level}'`,
    });
  }
});

export const FemaNriQuerySchema = z
  .object({
    geography: FemaNriQueryGeographySchema,
    variables: z
      .array(z.string().min(1).max(64))
      .max(50, 'Cannot request more than 50 variables in a single query')
      .optional(),
    vintage: z.string().min(4).max(64).optional(),
  })
  .passthrough()
  .superRefine((val, ctx) => {
    const knownKeys = new Set(['geography', 'variables', 'vintage']);
    const rawObj = val as Record<string, unknown>;
    for (const key of Object.keys(rawObj)) {
      if (!knownKeys.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `Unrecognized query parameter '${key}'`,
        });
      }
    }
  });
export type FemaNriQuery = z.infer<typeof FemaNriQuerySchema>;

// ============================================================================
// FEMA National Flood Hazard Layer (NFHL) Types & Schemas
// ============================================================================

export const FemaNfhlFloodZoneSchema = z.enum([
  'A',
  'AE',
  'A1-A30',
  'AH',
  'AO',
  'AR',
  'A99',
  'V',
  'VE',
  'V1-V30',
  'VO',
  'B',
  'C',
  'X',
  'D',
  'OPEN_WATER',
  'AREA_NOT_INCLUDED',
]);
export type FemaNfhlFloodZone = z.infer<typeof FemaNfhlFloodZoneSchema>;

export const FemaNfhlRiskCategorySchema = z.enum([
  'high_risk_sfha',
  'moderate_risk_500yr',
  'minimal_risk_outside_sfha',
  'undetermined_risk_zone_d',
  'unknown',
]);
export type FemaNfhlRiskCategory = z.infer<typeof FemaNfhlRiskCategorySchema>;

export const FemaNfhlBoundingBoxSchema = z
  .tuple([
    z.number().finite().min(-180).max(180), // min_lon
    z.number().finite().min(-90).max(90), // min_lat
    z.number().finite().min(-180).max(180), // max_lon
    z.number().finite().min(-90).max(90), // max_lat
  ])
  .superRefine(([minLon, minLat, maxLon, maxLat], ctx) => {
    if (minLon > maxLon) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [0],
        message: 'min_lon must not exceed max_lon',
      });
    }
    if (minLat > maxLat) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [1],
        message: 'min_lat must not exceed max_lat',
      });
    }
  });
export type FemaNfhlBoundingBox = z.infer<typeof FemaNfhlBoundingBoxSchema>;

export const FemaNfhlFloodHazardFeatureSchema = z
  .object({
    dfirm_id: z.string().min(1).max(32),
    fld_ar_id: z.string().min(1).max(32),
    fld_zone: FemaNfhlFloodZoneSchema,
    zone_subty: z.string().max(128).nullable().optional(),
    sfha_tf: z.boolean(),
    static_bfe: EconomicEstimateSchema,
    v_datum: z.string().max(32).nullable().optional(),
    depth: EconomicEstimateSchema,
    study_typ: z.string().max(64).nullable().optional(),
    source_cit: z.string().max(64).nullable().optional(),
    bounding_box: FemaNfhlBoundingBoxSchema.optional(),
  })
  .strict();
export type FemaNfhlFloodHazardFeature = z.infer<typeof FemaNfhlFloodHazardFeatureSchema>;

export const FemaNfhlSummarySchema = z
  .object({
    geography: EconomicGeographySchema,
    dominant_zone: FemaNfhlFloodZoneSchema,
    risk_category: FemaNfhlRiskCategorySchema,
    in_sfha: z.boolean(),
    has_floodway: z.boolean(),
    base_flood_elevation: EconomicEstimateSchema,
    vertical_datum: z.string().nullable().optional(),
    feature_count: z.number().int().nonnegative(),
    provenance: DataProvenanceSchema,
    advisory_disclaimer: z.literal(FEMA_NFHL_ADVISORY_DISCLAIMER),
  })
  .strict();
export type FemaNfhlSummary = z.infer<typeof FemaNfhlSummarySchema>;

export const FemaNfhlQuerySchema = z
  .object({
    geography: EconomicGeographySchema.optional(),
    point: z
      .object({
        latitude: z.number().finite().min(-90).max(90),
        longitude: z.number().finite().min(-180).max(180),
      })
      .strict()
      .optional(),
    bounding_box: FemaNfhlBoundingBoxSchema.optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (!val.geography && !val.point && !val.bounding_box) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'FEMA NFHL query must provide at least one of: geography, point, or bounding_box',
      });
    }
  });
export type FemaNfhlQuery = z.infer<typeof FemaNfhlQuerySchema>;

export const FemaNfhlFeaturesDatasetSchema = z
  .object({
    schema_version: z.literal(FEMA_NFHL_SCHEMA_VERSION),
    fixture_id: z.literal('fema-nfhl-features-synthetic-v1'),
    source_id: z.literal('fema-nri-nfhl'),
    title: z.string().min(1).max(256),
    description: z.string().min(1).max(1000),
    provenance: DataProvenanceSchema,
    features: z.array(FemaNfhlFloodHazardFeatureSchema).min(1),
  })
  .strict();
export type FemaNfhlFeaturesDataset = z.infer<typeof FemaNfhlFeaturesDatasetSchema>;
