import { z } from 'zod';
import { BlsLauPeriodSchema, BlsLauSeriesIdSchema } from './blsLau.js';
import { BlsSocCodeSchema } from './blsOews.js';
import {
  ECONOMIC_LEGAL_DISCLAIMER,
  ECONOMIC_SCHEMA_VERSION,
  EconomicEstimateSchema,
  EconomicEvidenceBundleSchema,
  EconomicEvidenceRecordSchema,
  EconomicGeographySchema,
} from './economic.js';
import { TenantIdSchema } from './identity.js';
import { DisagreementStateSchema } from './marketAnalysis.js';
import { DataProvenanceSchema } from './provenance.js';

// ============================================================================
// Workforce Labor-Market Signal Statutory Disclaimer (PLAN.md §10.2, ADR 0061)
// ============================================================================

export const WORKFORCE_LABOR_MARKET_SIGNAL_DISCLAIMER =
  'Statistical labor-market survey signal based on BLS Occupational Employment and Wage Statistics (OEWS) and Local Area Unemployment Statistics (LAU). Reflects aggregate benchmark survey estimates and statistical models. Not live job postings, individual candidate/worker records, or automated hiring decisions. Confidentiality and data quality suppressions are preserved.';

// Prohibited worker-level PII fields
const PROHIBITED_WORKER_PII_KEYS = [
  'ssn',
  'social_security',
  'applicant_id',
  'candidate_id',
  'employee_id',
  'worker_name',
  'first_name',
  'last_name',
  'personal_email',
  'home_address',
  'date_of_birth',
  'dob',
  'wage_slip',
  'paystub',
  'individual_compensation',
] as const;

export function checkForWorkerPii(data: Record<string, unknown>, path: string = ''): void {
  for (const [key, value] of Object.entries(data)) {
    const currentPath = path ? `${path}.${key}` : key;
    const lowerKey = key.toLowerCase();
    for (const prohibited of PROHIBITED_WORKER_PII_KEYS) {
      if (lowerKey === prohibited || lowerKey.includes(prohibited)) {
        throw new Error(
          `Prohibited worker-level PII field detected at '${currentPath}': '${key}'. BLS workforce analysis operates exclusively on aggregate occupational statistics.`
        );
      }
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      checkForWorkerPii(value as Record<string, unknown>, currentPath);
    }
  }
}

// ============================================================================
// Workforce Concentration & Specialization Contracts
// ============================================================================

export const WorkforceSpecializationTierSchema = z.enum([
  'high_specialization',
  'average',
  'underrepresented',
  'suppressed',
]);
export type WorkforceSpecializationTier = z.infer<typeof WorkforceSpecializationTierSchema>;

export const WorkforceOccupationalSpecializationSchema = z
  .object({
    soc_code: BlsSocCodeSchema,
    occupation_title: z.string().min(1).max(200),
    local_employment: EconomicEstimateSchema,
    benchmark_employment: EconomicEstimateSchema,
    location_quotient: z.number().finite().nonnegative().nullable(),
    tier: WorkforceSpecializationTierSchema,
  })
  .strict();
export type WorkforceOccupationalSpecialization = z.infer<
  typeof WorkforceOccupationalSpecializationSchema
>;

export const WorkforceConcentrationMetricSchema = z
  .object({
    hhi: z.number().finite().min(0).max(10000),
    tier: z.enum(['unconcentrated', 'moderately_concentrated', 'highly_concentrated']),
    occupation_count: z.number().int().nonnegative(),
    top_share_pct: z.number().finite().min(0).max(100),
    cr4_pct: z.number().finite().min(0).max(100).optional(),
    major_groups: z
      .array(
        z
          .object({
            soc_major_group: z.string().regex(/^[0-9]{2}-0000$/),
            title: z.string().min(1).max(200),
            share_pct: z.number().finite().min(0).max(100),
            employment: EconomicEstimateSchema,
          })
          .strict()
      )
      .max(30)
      .optional(),
  })
  .strict();
export type WorkforceConcentrationMetric = z.infer<typeof WorkforceConcentrationMetricSchema>;

// ============================================================================
// Wage Differentials Contracts (Percentiles, Ratios, Disparities)
// ============================================================================

export const WorkforceWagePercentilesSchema = z
  .object({
    pct10: EconomicEstimateSchema,
    pct25: EconomicEstimateSchema,
    median: EconomicEstimateSchema,
    pct75: EconomicEstimateSchema,
    pct90: EconomicEstimateSchema,
    mean: EconomicEstimateSchema,
  })
  .strict();
export type WorkforceWagePercentiles = z.infer<typeof WorkforceWagePercentilesSchema>;

export const WorkforceWageDifferentialSummarySchema = z
  .object({
    soc_code: BlsSocCodeSchema,
    occupation_title: z.string().min(1).max(200),
    hourly_percentiles: WorkforceWagePercentilesSchema,
    annual_percentiles: WorkforceWagePercentilesSchema,
    ratio_90_10: EconomicEstimateSchema,
    ratio_75_25: EconomicEstimateSchema,
    benchmark_median_hourly_usd: EconomicEstimateSchema,
    local_to_benchmark_ratio: EconomicEstimateSchema,
    dispersion_classification: z.enum([
      'compressed',
      'moderate',
      'dispersed',
      'highly_dispersed',
      'suppressed',
    ]),
  })
  .strict();
export type WorkforceWageDifferentialSummary = z.infer<
  typeof WorkforceWageDifferentialSummarySchema
>;

// ============================================================================
// Unemployment & Labor Force Dynamics Contracts (BLS LAU)
// ============================================================================

export const WorkforceUnemploymentSummarySchema = z
  .object({
    series_id: BlsLauSeriesIdSchema.optional(),
    period: BlsLauPeriodSchema,
    year: z.string().regex(/^20[0-9]{2}$/),
    civilian_labor_force: EconomicEstimateSchema,
    employed_count: EconomicEstimateSchema,
    unemployed_count: EconomicEstimateSchema,
    unemployment_rate_pct: EconomicEstimateSchema,
    monthly_change_pct_points: z.number().finite().nullable(),
    unemployment_status: z.enum(['low', 'moderate', 'elevated', 'high', 'unavailable']),
  })
  .strict();
export type WorkforceUnemploymentSummary = z.infer<typeof WorkforceUnemploymentSummarySchema>;

// ============================================================================
// Workforce Analysis Input & Output Contracts
// ============================================================================

export const WorkforceAnalysisInputSchema = z
  .object({
    analysis_id: z.string().min(1).max(128).optional(),
    tenant_id: TenantIdSchema.default('tenant-local'),
    target_geography: EconomicGeographySchema,
    soc_code: BlsSocCodeSchema.default('00-0000'),
    occupation_title: z.string().min(1).max(200).optional(),
    benchmark_geography: EconomicGeographySchema.optional(),
    oews_evidence: z.array(EconomicEvidenceRecordSchema).max(200).default([]),
    lau_evidence: z.array(EconomicEvidenceRecordSchema).max(200).default([]),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    try {
      checkForWorkerPii(data as Record<string, unknown>);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          err instanceof Error ? err.message : 'Worker PII is prohibited in workforce analysis',
        path: ['worker_pii_check'],
      });
    }
  });
export type WorkforceAnalysisInput = z.infer<typeof WorkforceAnalysisInputSchema>;

export const WorkforceAnalysisResultSchema = z
  .object({
    schema_version: z.literal(ECONOMIC_SCHEMA_VERSION),
    analysis_id: z.string().min(1).max(128),
    tenant_id: TenantIdSchema,
    target_geography: EconomicGeographySchema,
    soc_code: BlsSocCodeSchema,
    occupation_title: z.string().min(1).max(200),
    analyzed_at: z.string().datetime({ offset: true }),
    signal_type: z.literal('aggregate_labor_market_survey_signal'),
    labor_market_concentration: WorkforceConcentrationMetricSchema,
    wage_differentials: WorkforceWageDifferentialSummarySchema,
    occupational_specialization: WorkforceOccupationalSpecializationSchema,
    unemployment_dynamics: WorkforceUnemploymentSummarySchema,
    disagreement_state: DisagreementStateSchema,
    evidence_bundle: EconomicEvidenceBundleSchema,
    provenance: DataProvenanceSchema,
    disclaimer: z.string().min(1).max(1000),
    legal_disclaimer: z.literal(ECONOMIC_LEGAL_DISCLAIMER),
  })
  .strict();
export type WorkforceAnalysisResult = z.infer<typeof WorkforceAnalysisResultSchema>;
