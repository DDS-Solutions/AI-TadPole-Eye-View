import { z } from 'zod';
import { DotBtsAccessibilityTierSchema, DotBtsFreightCorridorExposureSchema } from './dotBts.js';
import { EconomicEstimateSchema, EconomicGeographySchema } from './economic.js';
import { FemaNfhlRiskCategorySchema, FemaNriRiskRatingSchema } from './fema.js';
import { DataProvenanceSchema } from './provenance.js';

// ============================================================================
// Pure Site-Risk & Multi-Source Screening Contracts
// (PLAN.md §10 Task 11.4, Phase 11 Exit, & ADR 0065)
// ============================================================================

export const SITE_RISK_SCHEMA_VERSION = 1 as const;

export const SITE_RISK_SCREENING_DISCLAIMER =
  'Site-risk and accessibility assessments are preliminary, multi-source screening signals derived from public federal datasets (FEMA NRI/NFHL, USGS 3DEP, EPA AQS, and DOT/BTS). They are NOT definitive engineering, geotechnical, environmental, underwriting, insurance, or regulatory compliance advice, and do not replace licensed inspections or certified determinations. Active operational alerts represent current conditions and remain strictly separate from long-term structural hazards.' as const;

export const SiteRiskScreeningTierSchema = z.enum([
  'elevated_screening_concern',
  'moderate_screening_concern',
  'low_screening_concern',
  'insufficient_data',
]);
export type SiteRiskScreeningTier = z.infer<typeof SiteRiskScreeningTierSchema>;

export const SiteRiskSourceAttributionSchema = z
  .object({
    source_id: z.string().min(1).max(64),
    product_name: z.string().min(1).max(200),
    vintage: z.string().min(1).max(200),
    geography: EconomicGeographySchema,
    mode: z.enum(['seed', 'live', 'cached', 'download_pack', 'unavailable']),
    status: z.enum(['available', 'partial', 'unavailable']),
    notes: z.string().max(500).optional(),
  })
  .strict();
export type SiteRiskSourceAttribution = z.infer<typeof SiteRiskSourceAttributionSchema>;

export const SiteRiskLongTermHazardsSchema = z
  .object({
    horizon: z.literal('long_term_structural_hazard'),
    fema_nri_composite_score: EconomicEstimateSchema,
    fema_nri_rating: FemaNriRiskRatingSchema,
    fema_nfhl_risk_category: FemaNfhlRiskCategorySchema,
    in_sfha: z.boolean().nullable(),
    elevation_meters: EconomicEstimateSchema,
    terrain_slope_percent: EconomicEstimateSchema,
    historical_air_exceedance_flags: z.array(z.string().min(1).max(128)),
    available_signal_count: z.number().int().nonnegative(),
  })
  .strict();
export type SiteRiskLongTermHazards = z.infer<typeof SiteRiskLongTermHazardsSchema>;

export const SiteRiskCurrentOperationalAlertsSchema = z
  .object({
    horizon: z.literal('current_operational_alert'),
    is_live_condition: z.literal(true),
    active_alert_count: z.number().int().nonnegative(),
    highest_severity: z.enum(['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown', 'None']),
    alert_headlines: z.array(z.string().min(1).max(300)).max(25),
    source_note: z.string().min(1).max(300),
  })
  .strict();
export type SiteRiskCurrentOperationalAlerts = z.infer<
  typeof SiteRiskCurrentOperationalAlertsSchema
>;

export const SiteRiskAccessibilitySummarySchema = z
  .object({
    accessibility_tier: DotBtsAccessibilityTierSchema,
    freight_exposure: DotBtsFreightCorridorExposureSchema,
    nearest_interstate_km: EconomicEstimateSchema,
    nearest_transit_stop_km: EconomicEstimateSchema,
    commute_mean_minutes: EconomicEstimateSchema,
  })
  .strict();
export type SiteRiskAccessibilitySummary = z.infer<typeof SiteRiskAccessibilitySummarySchema>;

export const SiteRiskOperationalAlertInputSchema = z
  .object({
    id: z.string().min(1).max(128),
    event: z.string().min(1).max(200),
    severity: z.enum(['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown']),
    headline: z.string().min(1).max(300).optional(),
  })
  .strict();
export type SiteRiskOperationalAlertInputContract = z.infer<
  typeof SiteRiskOperationalAlertInputSchema
>;

export const SiteRiskAnalysisRequestSchema = z
  .object({
    tenant_id: z.string().min(1).max(128).optional(),
    geography: EconomicGeographySchema,
    point: z
      .object({
        x: z.number().finite().min(-180).max(180),
        y: z.number().finite().min(-90).max(90),
      })
      .strict()
      .optional(),
    include_current_alerts: z.boolean().default(true),
    current_alerts: z.array(SiteRiskOperationalAlertInputSchema).max(25).optional(),
  })
  .strict();
export type SiteRiskAnalysisRequest = z.input<typeof SiteRiskAnalysisRequestSchema>;
export type ParsedSiteRiskAnalysisRequest = z.infer<typeof SiteRiskAnalysisRequestSchema>;

export const SiteRiskAssessmentResultSchema = z
  .object({
    schema_version: z.literal(SITE_RISK_SCHEMA_VERSION),
    geography: EconomicGeographySchema,
    assessed_at: z.string().datetime(),
    overall_screening_score: EconomicEstimateSchema,
    screening_tier: SiteRiskScreeningTierSchema,
    long_term_hazards: SiteRiskLongTermHazardsSchema,
    current_operational_alerts: SiteRiskCurrentOperationalAlertsSchema,
    accessibility_context: SiteRiskAccessibilitySummarySchema,
    source_signals: z.array(SiteRiskSourceAttributionSchema).min(1),
    data_gaps: z.array(z.string().min(1).max(300)),
    is_definitive_advice: z.literal(false),
    provenance: DataProvenanceSchema,
    advisory_disclaimer: z.literal(SITE_RISK_SCREENING_DISCLAIMER),
  })
  .strict()
  .superRefine((res, ctx) => {
    if (res.long_term_hazards.available_signal_count === 0) {
      if (res.overall_screening_score.status === 'available') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['overall_screening_score', 'status'],
          message:
            'Non-coercion law: site-risk screening score cannot be available when zero long-term hazard signals are available',
        });
      }
      if (res.screening_tier !== 'insufficient_data') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['screening_tier'],
          message:
            'Site-risk screening_tier must be insufficient_data when zero long-term hazard signals are available',
        });
      }
    }
  });
export type SiteRiskAssessmentResult = z.infer<typeof SiteRiskAssessmentResultSchema>;
