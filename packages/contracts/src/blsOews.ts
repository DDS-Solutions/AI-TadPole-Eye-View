import { z } from 'zod';
import { EconomicGeographySchema } from './economic.js';

// ============================================================================
// BLS OEWS Contracts (PLAN.md §10 Task 10.1 & ADR 0052)
// ============================================================================

export const BLS_OEWS_SCHEMA_VERSION = 1 as const;
export const BLS_OEWS_DEFAULT_VINTAGE = 'May 2024' as const;

export const BLS_OEWS_ANNUAL_STATISTICAL_DISCLAIMER =
  'Occupational Employment and Wage Statistics (OEWS) are annual benchmark survey estimates of occupational employment and wage distributions for non-farm wage and salary workers. They are not real-time job openings, individual employee compensation records, or worker-level applicant data.' as const;

export const BLS_API_LIMITS_UNREGISTERED = {
  daily_requests: 25,
  max_series_per_query: 10,
  max_years_per_query: 10,
} as const;

export const BLS_API_LIMITS_REGISTERED = {
  daily_requests: 500,
  max_series_per_query: 50,
  max_years_per_query: 20,
} as const;

export const BlsSocCodeSchema = z
  .string()
  .min(7)
  .max(7)
  .regex(/^[0-9]{2}-[0-9]{4}$/, 'SOC code must follow format XX-XXXX (e.g. 15-1252)');
export type BlsSocCode = z.infer<typeof BlsSocCodeSchema>;

export const BlsOewsVariableIdSchema = z.enum([
  'TOT_EMP',
  'EMP_PRSE',
  'H_MEAN',
  'A_MEAN',
  'MEAN_PRSE',
  'H_PCT10',
  'H_PCT25',
  'H_MEDIAN',
  'H_PCT75',
  'H_PCT90',
  'A_PCT10',
  'A_PCT25',
  'A_MEDIAN',
  'A_PCT75',
  'A_PCT90',
  'ANNUAL',
  'HOURLY',
]);
export type BlsOewsVariableId = z.infer<typeof BlsOewsVariableIdSchema>;

export const BlsOewsUnitSchema = z.enum(['USD', 'USD_per_hour', 'count', 'percent', 'ratio']);
export type BlsOewsUnit = z.infer<typeof BlsOewsUnitSchema>;

export const BlsOewsWageTypeSchema = z.enum(['annual', 'hourly', 'employment', 'general']);
export type BlsOewsWageType = z.infer<typeof BlsOewsWageTypeSchema>;

export const BlsOewsVariableDefinitionSchema = z
  .object({
    variable_id: BlsOewsVariableIdSchema,
    metric_id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9-]+$/, 'metric_id must be lowercase alphanumeric with hyphens'),
    label: z.string().min(1).max(256),
    statistical_definition: z.string().min(1).max(1000),
    universe: z.string().min(1).max(256),
    unit: BlsOewsUnitSchema,
    wage_type: BlsOewsWageTypeSchema,
    supported_geographies: z.array(z.string().min(1).max(32)).min(1),
    tags: z.array(z.string().min(1).max(64)).max(16),
  })
  .strict();
export type BlsOewsVariableDefinition = z.infer<typeof BlsOewsVariableDefinitionSchema>;

export const BlsOewsVariableDictionarySchema = z
  .object({
    schema_version: z.literal(BLS_OEWS_SCHEMA_VERSION),
    version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Version must follow semver X.Y.Z'),
    program: z.literal('oews'),
    annual_disclaimer: z.literal(BLS_OEWS_ANNUAL_STATISTICAL_DISCLAIMER),
    vintages_supported: z.array(z.string().min(4).max(64)).min(1),
    variables: z.record(z.string(), BlsOewsVariableDefinitionSchema),
  })
  .strict();
export type BlsOewsVariableDictionary = z.infer<typeof BlsOewsVariableDictionarySchema>;

export const BlsOewsQueryGeographySchema = EconomicGeographySchema.superRefine((geo, ctx) => {
  const allowedLevels = ['cbsa', 'state', 'nation', 'county'];
  if (!allowedLevels.includes(geo.level)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['level'],
      message: `BLS OEWS queries support geographies: ${allowedLevels.join(', ')}. Received '${geo.level}'`,
    });
  }
});

/**
 * List of prohibited employee/applicant PII fields.
 * Any request attempting to supply individual worker or applicant data is rejected.
 */
export const PROHIBITED_WORKER_PII_FIELDS = [
  'ssn',
  'social_security_number',
  'employee_name',
  'applicant_name',
  'first_name',
  'last_name',
  'full_name',
  'email',
  'phone',
  'dob',
  'date_of_birth',
  'resume',
  'candidate_id',
  'applicant_id',
  'employee_id',
  'driver_license',
  'salary_history',
] as const;

export const BlsOewsQuerySchema = z
  .object({
    geography: BlsOewsQueryGeographySchema,
    soc_code: BlsSocCodeSchema.optional(),
    variables: z
      .array(z.string().min(1).max(64))
      .max(20, 'Cannot request more than 20 variables in a single query')
      .optional(),
    vintage: z.string().min(4).max(64).optional(),
    is_registered: z.boolean().optional(),
  })
  .passthrough()
  .superRefine((val, ctx) => {
    const knownKeys = new Set(['geography', 'soc_code', 'variables', 'vintage', 'is_registered']);
    const rawObj = val as Record<string, unknown>;
    for (const key of Object.keys(rawObj)) {
      const lowerKey = key.toLowerCase();
      if (PROHIBITED_WORKER_PII_FIELDS.some((pii) => lowerKey === pii || lowerKey.includes(pii))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `Prohibited employee/applicant PII field '${key}' detected. BLS workforce ingestion strictly prohibits worker PII.`,
        });
      } else if (!knownKeys.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `Unrecognized query parameter '${key}'`,
        });
      }
    }

    // Enforce rate limits: unregistered max 10 series/variables, registered max 20 variables (50 series)
    const maxVars = val.is_registered
      ? BLS_API_LIMITS_REGISTERED.max_series_per_query
      : BLS_API_LIMITS_UNREGISTERED.max_series_per_query;
    if (val.variables && val.variables.length > maxVars) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['variables'],
        message: `Requested ${val.variables.length} variables exceeds BLS API limit of ${maxVars} for ${val.is_registered ? 'registered' : 'unregistered'} queries`,
      });
    }
  });
export type BlsOewsQuery = z.infer<typeof BlsOewsQuerySchema>;

export const BlsOewsRawCellSchema = z.union([z.string(), z.number(), z.null(), z.undefined()]);
export type BlsOewsRawCell = z.infer<typeof BlsOewsRawCellSchema>;
