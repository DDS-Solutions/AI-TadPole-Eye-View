import { z } from 'zod';
import { EconomicEstimateSchema, EconomicGeographySchema } from './economic.js';
import { DataProvenanceSchema } from './provenance.js';

// ============================================================================
// EPA Air Quality System (AQS) Historical Monitoring Contracts
// (PLAN.md §10 Task 11.3 & ADR 0064)
// ============================================================================

export const EPA_AQS_SCHEMA_VERSION = 1 as const;
export const EPA_AQS_DEFAULT_VINTAGE =
  'EPA AQS Quarterly & Annual Regulatory Summaries (2024)' as const;
export const EPA_AQS_BASE_URL = 'https://aqs.epa.gov/data/api' as const;
export const EPA_AQS_PROHIBITED_REALTIME_HOST = 'airnowapi.org' as const;
export const EPA_AQS_DATA_CLASSIFICATION = 'historical_regulatory_monitoring' as const;

export const EPA_AQS_HISTORICAL_DISCLAIMER =
  'EPA Air Quality System (AQS) data consists of historical, quality-assured regulatory ambient air monitoring summaries (quarterly and annual). It is NOT real-time Air Quality Index (AQI) or current air quality conditions (which are separate AirNow scope). Unmonitored criteria pollutants or missing observations are reported as unavailable and never coerced to 0.0. Results are provided for historical environmental screening only and do not constitute regulatory attainment determinations, compliance certifications, or medical/health advisories.' as const;

export const EPA_AQS_CRITERIA_POLLUTANTS = ['O3', 'PM2.5', 'PM10', 'CO', 'NO2', 'SO2'] as const;

export const EpaAqsPollutantSymbolSchema = z.enum(EPA_AQS_CRITERIA_POLLUTANTS);
export type EpaAqsPollutantSymbol = z.infer<typeof EpaAqsPollutantSymbolSchema>;

export const EpaAqsParameterCodeSchema = z.enum([
  '44201', // Ozone (O3)
  '88101', // PM2.5 - Local Conditions (FRM/FEM Mass)
  '81102', // PM10 Total 0-10um STP
  '42101', // Carbon monoxide (CO)
  '42602', // Nitrogen dioxide (NO2)
  '42401', // Sulfur dioxide (SO2)
]);
export type EpaAqsParameterCode = z.infer<typeof EpaAqsParameterCodeSchema>;

export const EpaAqsSummaryPeriodSchema = z.enum(['quarterly', 'annual']);
export type EpaAqsSummaryPeriod = z.infer<typeof EpaAqsSummaryPeriodSchema>;

export const EpaAqsQuarterSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export type EpaAqsQuarter = z.infer<typeof EpaAqsQuarterSchema>;

export const EpaAqsSiteIdSchema = z
  .string()
  .regex(/^[0-9]{2}-[0-9]{3}-[0-9]{4}$/, 'EPA AQS site ID must follow SS-CCC-NNNN format');
export type EpaAqsSiteId = z.infer<typeof EpaAqsSiteIdSchema>;

export const EpaAqsCompletenessSchema = z.enum(['Y', 'N', 'unknown']);
export type EpaAqsCompleteness = z.infer<typeof EpaAqsCompletenessSchema>;

export const EpaAqsEventsIncludedSchema = z.enum([
  'Events Included',
  'Events Excluded',
  'No Events',
  'unknown',
]);
export type EpaAqsEventsIncluded = z.infer<typeof EpaAqsEventsIncludedSchema>;

// ============================================================================
// Parameter Dictionary Schema
// ============================================================================

export const EpaAqsParameterDefinitionSchema = z
  .object({
    parameter_code: EpaAqsParameterCodeSchema,
    pollutant_symbol: EpaAqsPollutantSymbolSchema,
    name: z.string().min(1).max(200),
    standard_unit: z.enum(['ppm', 'ppb', 'ug/m3']),
    averaging_periods: z.array(z.string().min(1).max(64)).min(1),
    naaqs_primary_standard: z.string().min(1).max(200),
    description: z.string().min(1).max(1000),
  })
  .strict();
export type EpaAqsParameterDefinition = z.infer<typeof EpaAqsParameterDefinitionSchema>;

// ============================================================================
// Monitoring Site Schema
// ============================================================================

export const EpaAqsMonitoringSiteSchema = z
  .object({
    site_id: EpaAqsSiteIdSchema,
    state_fips: z.string().regex(/^[0-9]{2}$/),
    county_fips: z.string().regex(/^[0-9]{5}$/),
    site_number: z.string().regex(/^[0-9]{4}$/),
    local_site_name: z.string().min(1).max(200),
    city_name: z.string().min(1).max(120).optional(),
    county_name: z.string().min(1).max(120),
    state_postal: z.string().regex(/^[A-Z]{2}$/),
    cbsa_code: z
      .string()
      .regex(/^[0-9]{5}$/)
      .nullable()
      .optional(),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    datum: z.enum(['WGS84', 'NAD83', 'unknown']).default('WGS84'),
    monitored_parameters: z.array(EpaAqsParameterCodeSchema).min(1),
    monitoring_objective: z.string().min(1).max(200).optional(),
    measurement_scale: z.string().min(1).max(120).optional(),
    open_date: z.string().min(4).max(32).optional(),
    close_date: z.string().min(4).max(32).nullable().optional(),
  })
  .strict()
  .superRefine((site, ctx) => {
    const expectedId = `${site.state_fips}-${site.county_fips.slice(2, 5)}-${site.site_number}`;
    if (site.county_fips.slice(0, 2) !== site.state_fips) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['county_fips'],
        message: 'county_fips first 2 digits must match state_fips',
      });
    }
    if (site.site_id !== expectedId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['site_id'],
        message: `site_id '${site.site_id}' must match '${expectedId}'`,
      });
    }
  });
export type EpaAqsMonitoringSite = z.infer<typeof EpaAqsMonitoringSiteSchema>;

// ============================================================================
// Quarterly / Annual Summary Record Schema
// ============================================================================

export const EpaAqsSummaryRecordSchema = z
  .object({
    site_id: EpaAqsSiteIdSchema,
    geography: EconomicGeographySchema,
    parameter_code: EpaAqsParameterCodeSchema,
    pollutant_symbol: EpaAqsPollutantSymbolSchema,
    summary_period: EpaAqsSummaryPeriodSchema,
    year: z.number().int().min(1980).max(2100),
    quarter: EpaAqsQuarterSchema.nullable(),
    sample_duration: z.string().min(1).max(100),
    metric_used: z.string().min(1).max(200),
    pollutant_standard: z.string().min(1).max(200).nullable().optional(),
    arithmetic_mean: EconomicEstimateSchema,
    first_max_value: EconomicEstimateSchema,
    second_max_value: EconomicEstimateSchema,
    ninety_eighth_percentile: EconomicEstimateSchema,
    observation_count: z.number().int().nonnegative(),
    observation_percent: EconomicEstimateSchema,
    completeness_indicator: EpaAqsCompletenessSchema,
    events_included: EpaAqsEventsIncludedSchema.default('unknown'),
    is_monitored: z.boolean(),
    data_classification: z.literal(EPA_AQS_DATA_CLASSIFICATION),
    is_real_time: z.literal(false),
  })
  .strict()
  .superRefine((rec, ctx) => {
    if (rec.summary_period === 'quarterly' && rec.quarter === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['quarter'],
        message: 'Quarterly AQS summary must specify quarter (1-4)',
      });
    }
    if (rec.summary_period === 'annual' && rec.quarter !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['quarter'],
        message: 'Annual AQS summary must set quarter to null',
      });
    }
    // Non-coercion law: unmonitored pollutants or zero observations must NEVER be available (or 0.0)
    if (!rec.is_monitored || rec.observation_count === 0) {
      const fields = [
        ['arithmetic_mean', rec.arithmetic_mean],
        ['first_max_value', rec.first_max_value],
        ['second_max_value', rec.second_max_value],
        ['ninety_eighth_percentile', rec.ninety_eighth_percentile],
      ] as const;
      for (const [name, est] of fields) {
        if (est.status === 'available') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [name, 'status'],
            message: `Non-coercion law: unmonitored or zero-observation ${name} must not evaluate to available`,
          });
        }
      }
    }
  });
export type EpaAqsSummaryRecord = z.infer<typeof EpaAqsSummaryRecordSchema>;

// ============================================================================
// Per-Pollutant Coverage Summary Schema
// ============================================================================

export const EpaAqsPollutantCoverageSchema = z
  .object({
    pollutant_symbol: EpaAqsPollutantSymbolSchema,
    parameter_code: EpaAqsParameterCodeSchema,
    is_monitored: z.boolean(),
    site_count: z.number().int().nonnegative(),
    summary_count: z.number().int().nonnegative(),
    latest_arithmetic_mean: EconomicEstimateSchema,
    data_classification: z.literal(EPA_AQS_DATA_CLASSIFICATION),
    is_real_time: z.literal(false),
  })
  .strict()
  .superRefine((cov, ctx) => {
    if (!cov.is_monitored && cov.latest_arithmetic_mean.status === 'available') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['latest_arithmetic_mean', 'status'],
        message: 'Non-coercion law: unmonitored pollutant coverage must not evaluate to available',
      });
    }
  });
export type EpaAqsPollutantCoverage = z.infer<typeof EpaAqsPollutantCoverageSchema>;

// ============================================================================
// Query & Query Result Schemas
// ============================================================================

export const EpaAqsQuerySchema = z
  .object({
    geography: EconomicGeographySchema,
    pollutants: z.array(EpaAqsPollutantSymbolSchema).min(1).max(6).optional(),
    summary_period: EpaAqsSummaryPeriodSchema.optional(),
    year: z.number().int().min(1980).max(2100).optional(),
    quarter: EpaAqsQuarterSchema.optional(),
    radius_km: z.number().finite().positive().max(250).default(50),
    include_unmonitored: z.boolean().default(true),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (q.summary_period === 'annual' && q.quarter !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['quarter'],
        message: 'quarter cannot be specified when summary_period is annual',
      });
    }
  });
export type EpaAqsQuery = z.input<typeof EpaAqsQuerySchema>;
export type ParsedEpaAqsQuery = z.infer<typeof EpaAqsQuerySchema>;

export const EpaAqsQueryResultSchema = z
  .object({
    geography: EconomicGeographySchema,
    data_classification: z.literal(EPA_AQS_DATA_CLASSIFICATION),
    is_real_time: z.literal(false),
    sites: z.array(EpaAqsMonitoringSiteSchema),
    summaries: z.array(EpaAqsSummaryRecordSchema),
    pollutant_coverage: z.array(EpaAqsPollutantCoverageSchema),
    provenance: DataProvenanceSchema,
    advisory_disclaimer: z.literal(EPA_AQS_HISTORICAL_DISCLAIMER),
  })
  .strict();
export type EpaAqsQueryResult = z.infer<typeof EpaAqsQueryResultSchema>;

// ============================================================================
// Raw EPA AQS Wire Schemas (https://aqs.epa.gov/data/api)
// ============================================================================

export const RawEpaAqsHeaderSchema = z
  .object({
    status: z.string(),
    request_time: z.string().optional(),
    url: z.string().optional(),
    rows: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type RawEpaAqsHeader = z.infer<typeof RawEpaAqsHeaderSchema>;

export const RawEpaAqsMonitorRowSchema = z
  .object({
    state_code: z.string(),
    county_code: z.string(),
    site_number: z.string(),
    parameter_code: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    datum: z.string().optional(),
    local_site_name: z.string().nullable().optional(),
    city_name: z.string().nullable().optional(),
    county_name: z.string().nullable().optional(),
    state_name: z.string().nullable().optional(),
    cbsa_code: z.string().nullable().optional(),
    monitoring_objective: z.string().nullable().optional(),
    measurement_scale: z.string().nullable().optional(),
    open_date: z.string().nullable().optional(),
    close_date: z.string().nullable().optional(),
  })
  .passthrough();
export type RawEpaAqsMonitorRow = z.infer<typeof RawEpaAqsMonitorRowSchema>;

export const RawEpaAqsSummaryRowSchema = z
  .object({
    state_code: z.string(),
    county_code: z.string(),
    site_number: z.string(),
    parameter_code: z.string(),
    year: z.union([z.number(), z.string()]),
    quarter: z.union([z.number(), z.string()]).nullable().optional(),
    units_of_measure: z.string().nullable().optional(),
    sample_duration: z.string().nullable().optional(),
    metric_used: z.string().nullable().optional(),
    pollutant_standard: z.string().nullable().optional(),
    arithmetic_mean: z.union([z.number(), z.string()]).nullable().optional(),
    first_max_value: z.union([z.number(), z.string()]).nullable().optional(),
    second_max_value: z.union([z.number(), z.string()]).nullable().optional(),
    ninety_eighth_percentile: z.union([z.number(), z.string()]).nullable().optional(),
    observation_count: z.union([z.number(), z.string()]).nullable().optional(),
    observation_percent: z.union([z.number(), z.string()]).nullable().optional(),
    completeness_indicator: z.string().nullable().optional(),
    events_included: z.string().nullable().optional(),
    state_name: z.string().nullable().optional(),
    county_name: z.string().nullable().optional(),
    cbsa_code: z.string().nullable().optional(),
  })
  .passthrough();
export type RawEpaAqsSummaryRow = z.infer<typeof RawEpaAqsSummaryRowSchema>;

export const RawEpaAqsMonitorResponseSchema = z
  .object({
    Header: z.array(RawEpaAqsHeaderSchema).min(1),
    Data: z.array(RawEpaAqsMonitorRowSchema),
  })
  .passthrough();

export const RawEpaAqsSummaryResponseSchema = z
  .object({
    Header: z.array(RawEpaAqsHeaderSchema).min(1),
    Data: z.array(RawEpaAqsSummaryRowSchema),
  })
  .passthrough();

// ============================================================================
// Synthetic Seed Fixture Dataset Schema
// ============================================================================

export const EpaAqsFixtureDatasetSchema = z
  .object({
    schema_version: z.literal(EPA_AQS_SCHEMA_VERSION),
    fixture_id: z.literal('epa-aqs-synthetic-v1'),
    source_id: z.literal('epa-aqs'),
    title: z.string().min(1).max(256),
    description: z.string().min(1).max(1000),
    data_classification: z.literal(EPA_AQS_DATA_CLASSIFICATION),
    is_real_time: z.literal(false),
    provenance: DataProvenanceSchema,
    sites: z.array(EpaAqsMonitoringSiteSchema).min(1),
    summaries: z.array(EpaAqsSummaryRecordSchema).min(1),
  })
  .strict();
export type EpaAqsFixtureDataset = z.infer<typeof EpaAqsFixtureDatasetSchema>;
