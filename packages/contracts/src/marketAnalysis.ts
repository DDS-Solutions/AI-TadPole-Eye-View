import { z } from 'zod';
import {
  DisagreementSeveritySchema,
  ECONOMIC_LEGAL_DISCLAIMER,
  ECONOMIC_SCHEMA_VERSION,
  EconomicEstimateSchema,
  EconomicEvidenceBundleSchema,
  EconomicEvidenceRecordSchema,
  EconomicGeographySchema,
} from './economic.js';
import { TenantIdSchema } from './identity.js';
import {
  OsmCommercialCategorySchema,
  OsmCommercialFootprintSummarySchema,
  OsmCommercialPoiFeatureSchema,
} from './osmCommercial.js';
import { DataProvenanceSchema } from './provenance.js';

// ============================================================================
// Source-Linked Disagreement Contracts (PLAN.md §8.2, §8.3, §9.4, ADR 0058)
// ============================================================================

export const SourceVariableLinkSchema = z
  .object({
    source_id: z.string().min(1).max(128),
    variable_id: z.string().min(1).max(128),
    metric_id: z.string().min(1).max(128),
    vintage: z.string().min(1).max(128),
    attribution: z.string().min(1).max(300),
  })
  .strict();
export type SourceVariableLink = z.infer<typeof SourceVariableLinkSchema>;

export const DisagreementTypeSchema = z.enum([
  'prediction_vs_observation',
  'cross_source_divergence',
  'temporal_shift',
  'status_disparity',
]);
export type DisagreementType = z.infer<typeof DisagreementTypeSchema>;

export const SourceLinkedDisagreementSchema = z
  .object({
    disagreement_id: z.string().min(1).max(128),
    indicator_key: z.string().min(1).max(128),
    disagreement_type: DisagreementTypeSchema,
    severity: DisagreementSeveritySchema,
    expected_signal: z
      .object({
        source_metric: z.string().min(1).max(128),
        variable_link: SourceVariableLinkSchema,
        description: z.string().min(1).max(500),
        estimate: EconomicEstimateSchema,
        provenance: DataProvenanceSchema,
      })
      .strict(),
    observed_signal: z
      .object({
        source_metric: z.string().min(1).max(128),
        variable_link: SourceVariableLinkSchema,
        description: z.string().min(1).max(500),
        estimate: EconomicEstimateSchema,
        provenance: DataProvenanceSchema,
      })
      .strict(),
    delta_metrics: z
      .object({
        absolute_delta: z.number().finite().nullable(),
        relative_delta_pct: z.number().finite().nullable(),
        direction: z.enum(['observed_higher', 'observed_lower', 'status_divergence']),
      })
      .strict(),
    resolution_state: z.literal('unresolved_preserved'),
    delta_description: z.string().min(1).max(1000),
  })
  .strict();
export type SourceLinkedDisagreement = z.infer<typeof SourceLinkedDisagreementSchema>;

export const DisagreementStateSchema = z
  .object({
    has_disagreements: z.boolean(),
    total_disagreements: z.number().int().nonnegative(),
    by_severity: z
      .object({
        info: z.number().int().nonnegative(),
        warning: z.number().int().nonnegative(),
        critical: z.number().int().nonnegative(),
      })
      .strict(),
    records: z.array(SourceLinkedDisagreementSchema).max(200),
  })
  .strict();
export type DisagreementState = z.infer<typeof DisagreementStateSchema>;

// ============================================================================
// Market Concentration Contracts (DOJ/FTC HHI Guidelines)
// ============================================================================

export const MarketConcentrationTierSchema = z.enum([
  'unconcentrated',
  'moderately_concentrated',
  'highly_concentrated',
]);
export type MarketConcentrationTier = z.infer<typeof MarketConcentrationTierSchema>;

export const HhiConcentrationResultSchema = z
  .object({
    hhi: z.number().finite().min(0).max(10000),
    tier: MarketConcentrationTierSchema,
    firm_count: z.number().int().nonnegative(),
    top_share_pct: z.number().finite().min(0).max(100),
    cr4_pct: z.number().finite().min(0).max(100).optional(),
  })
  .strict();
export type HhiConcentrationResult = z.infer<typeof HhiConcentrationResultSchema>;

// ============================================================================
// Market Analysis Contracts
// ============================================================================

export const MarketDemographicSummarySchema = z
  .object({
    total_population: EconomicEstimateSchema,
    median_household_income: EconomicEstimateSchema,
    poverty_rate_pct: EconomicEstimateSchema,
    bachelors_degree_rate_pct: EconomicEstimateSchema,
  })
  .strict();
export type MarketDemographicSummary = z.infer<typeof MarketDemographicSummarySchema>;

export const MarketBusinessSummarySchema = z
  .object({
    total_establishments: EconomicEstimateSchema,
    paid_employment: EconomicEstimateSchema,
    annual_payroll_usd_thousands: EconomicEstimateSchema,
    average_annual_wage_usd: EconomicEstimateSchema,
  })
  .strict();
export type MarketBusinessSummary = z.infer<typeof MarketBusinessSummarySchema>;

export const MarketTopCategorySchema = z
  .object({
    category: OsmCommercialCategorySchema,
    count: z.number().int().nonnegative(),
  })
  .strict();
export type MarketTopCategory = z.infer<typeof MarketTopCategorySchema>;

export const MarketCommercialFootprintSummarySchema = z
  .object({
    commercial_poi_count: EconomicEstimateSchema,
    commercial_density_per_km2: EconomicEstimateSchema,
    top_categories: z.array(MarketTopCategorySchema).max(10),
  })
  .strict();
export type MarketCommercialFootprintSummary = z.infer<
  typeof MarketCommercialFootprintSummarySchema
>;

export const MarketDerivedMetricsSchema = z
  .object({
    population_per_establishment: EconomicEstimateSchema,
    establishments_per_10k_residents: EconomicEstimateSchema,
    commercial_coverage_ratio: EconomicEstimateSchema,
  })
  .strict();
export type MarketDerivedMetrics = z.infer<typeof MarketDerivedMetricsSchema>;

export const MarketAnalysisInputSchema = z
  .object({
    analysis_id: z.string().min(1).max(128).optional(),
    tenant_id: TenantIdSchema.default('tenant-local'),
    target_geography: EconomicGeographySchema,
    naics_code: z
      .string()
      .regex(/^[0-9]{2,6}$/, 'NAICS code must be 2 to 6 numeric digits')
      .optional(),
    industry_title: z.string().min(1).max(200).optional(),
    acs_evidence: z.array(EconomicEvidenceRecordSchema).max(200).default([]),
    cbp_evidence: z.array(EconomicEvidenceRecordSchema).max(200).default([]),
    osm_footprint: OsmCommercialFootprintSummarySchema.optional(),
    osm_evidence: z.array(EconomicEvidenceRecordSchema).max(200).optional(),
    benchmark_density_expectation: z.number().finite().positive().optional(),
  })
  .strict();
export type MarketAnalysisInput = z.infer<typeof MarketAnalysisInputSchema>;

export const MarketAnalysisResultSchema = z
  .object({
    schema_version: z.literal(ECONOMIC_SCHEMA_VERSION),
    analysis_id: z.string().min(1).max(128),
    tenant_id: TenantIdSchema,
    target_geography: EconomicGeographySchema,
    analyzed_at: z.string().datetime({ offset: true }),
    demographics: MarketDemographicSummarySchema,
    business_activity: MarketBusinessSummarySchema,
    commercial_footprint: MarketCommercialFootprintSummarySchema,
    derived_metrics: MarketDerivedMetricsSchema,
    disagreement_state: DisagreementStateSchema,
    evidence_bundle: EconomicEvidenceBundleSchema,
    provenance: DataProvenanceSchema,
    disclaimer: z.literal(ECONOMIC_LEGAL_DISCLAIMER),
  })
  .strict();
export type MarketAnalysisResult = z.infer<typeof MarketAnalysisResultSchema>;

// ============================================================================
// Competition Analysis Contracts
// ============================================================================

export const CompetitionAnalysisInputSchema = z
  .object({
    analysis_id: z.string().min(1).max(128).optional(),
    tenant_id: TenantIdSchema.default('tenant-local'),
    target_geography: EconomicGeographySchema,
    naics_code: z.string().regex(/^[0-9]{2,6}$/, 'NAICS code must be 2 to 6 numeric digits'),
    industry_title: z.string().min(1).max(200),
    cbp_evidence: z.array(EconomicEvidenceRecordSchema).max(200).default([]),
    osm_poi_features: z.array(OsmCommercialPoiFeatureSchema).max(2000).default([]),
    osm_footprint: OsmCommercialFootprintSummarySchema.optional(),
    firm_shares_or_sizes: z.array(z.number().finite().nonnegative()).max(500).optional(),
  })
  .strict();
export type CompetitionAnalysisInput = z.infer<typeof CompetitionAnalysisInputSchema>;

export const CompetitionAnalysisResultSchema = z
  .object({
    schema_version: z.literal(ECONOMIC_SCHEMA_VERSION),
    analysis_id: z.string().min(1).max(128),
    tenant_id: TenantIdSchema,
    target_geography: EconomicGeographySchema,
    naics_code: z.string().regex(/^[0-9]{2,6}$/),
    industry_title: z.string().min(1).max(200),
    analyzed_at: z.string().datetime({ offset: true }),
    concentration: HhiConcentrationResultSchema,
    reported_establishments: EconomicEstimateSchema,
    observed_poi_competitors: EconomicEstimateSchema,
    competitor_density_per_km2: EconomicEstimateSchema,
    competitor_share_of_commercial_footprint_pct: EconomicEstimateSchema,
    disagreement_state: DisagreementStateSchema,
    evidence_bundle: EconomicEvidenceBundleSchema,
    provenance: DataProvenanceSchema,
    disclaimer: z.literal(ECONOMIC_LEGAL_DISCLAIMER),
  })
  .strict();
export type CompetitionAnalysisResult = z.infer<typeof CompetitionAnalysisResultSchema>;

// ============================================================================
// Location Comparison Contracts
// ============================================================================

export const LocationProfileInputSchema = z
  .object({
    location_key: z.string().min(1).max(64),
    label: z.string().min(1).max(200),
    geography: EconomicGeographySchema,
    acs_evidence: z.array(EconomicEvidenceRecordSchema).max(200).default([]),
    cbp_evidence: z.array(EconomicEvidenceRecordSchema).max(200).default([]),
    osm_footprint: OsmCommercialFootprintSummarySchema.optional(),
    osm_evidence: z.array(EconomicEvidenceRecordSchema).max(200).optional(),
  })
  .strict();
export type LocationProfileInput = z.infer<typeof LocationProfileInputSchema>;

export const LocationComparisonInputSchema = z
  .object({
    comparison_id: z.string().min(1).max(128).optional(),
    tenant_id: TenantIdSchema.default('tenant-local'),
    locations: z.array(LocationProfileInputSchema).min(2).max(10),
    benchmark_location_key: z.string().min(1).max(64).optional(),
    naics_code: z
      .string()
      .regex(/^[0-9]{2,6}$/)
      .optional(),
    industry_title: z.string().min(1).max(200).optional(),
  })
  .strict();
export type LocationComparisonInput = z.infer<typeof LocationComparisonInputSchema>;

export const LocationComparisonValueSchema = z
  .object({
    location_key: z.string().min(1).max(64),
    label: z.string().min(1).max(200),
    geography: EconomicGeographySchema,
    estimate: EconomicEstimateSchema,
    relative_to_benchmark_pct: z.number().finite().nullable(),
    rank: z.number().int().positive().nullable(),
  })
  .strict();
export type LocationComparisonValue = z.infer<typeof LocationComparisonValueSchema>;

export const LocationComparisonMetricRowSchema = z
  .object({
    metric_id: z.string().min(1).max(128),
    label: z.string().min(1).max(200),
    unit: z.string().min(1).max(64),
    values: z.array(LocationComparisonValueSchema),
  })
  .strict();
export type LocationComparisonMetricRow = z.infer<typeof LocationComparisonMetricRowSchema>;

export const LocationSpecializationComparisonSchema = z
  .object({
    location_key: z.string().min(1).max(64),
    label: z.string().min(1).max(200),
    geography: EconomicGeographySchema,
    naics_code: z.string().min(2).max(6),
    location_quotient: z.number().finite().nonnegative().nullable(),
    tier: z.enum(['high_specialization', 'average', 'underrepresented', 'suppressed']),
  })
  .strict();
export type LocationSpecializationComparison = z.infer<
  typeof LocationSpecializationComparisonSchema
>;

export const LocationComparisonResultSchema = z
  .object({
    schema_version: z.literal(ECONOMIC_SCHEMA_VERSION),
    comparison_id: z.string().min(1).max(128),
    tenant_id: TenantIdSchema,
    analyzed_at: z.string().datetime({ offset: true }),
    benchmark_location_key: z.string().min(1).max(64),
    locations: z.array(
      z
        .object({
          location_key: z.string().min(1).max(64),
          label: z.string().min(1).max(200),
          geography: EconomicGeographySchema,
        })
        .strict()
    ),
    metrics: z.array(LocationComparisonMetricRowSchema),
    specializations: z.array(LocationSpecializationComparisonSchema).optional(),
    disagreement_state: DisagreementStateSchema,
    evidence_bundle: EconomicEvidenceBundleSchema,
    provenance: DataProvenanceSchema,
    disclaimer: z.literal(ECONOMIC_LEGAL_DISCLAIMER),
  })
  .strict();
export type LocationComparisonResult = z.infer<typeof LocationComparisonResultSchema>;
