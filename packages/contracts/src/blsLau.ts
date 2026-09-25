import { z } from 'zod';
import {
  BLS_API_LIMITS_REGISTERED,
  BLS_API_LIMITS_UNREGISTERED,
  PROHIBITED_WORKER_PII_FIELDS,
} from './blsOews.js';
import { EconomicGeographySchema } from './economic.js';

// ============================================================================
// BLS LAU Contracts (PLAN.md §10 Task 10.1 & ADR 0052)
// ============================================================================

export const BLS_LAU_SCHEMA_VERSION = 1 as const;
export const BLS_LAU_DEFAULT_VINTAGE = '2026-07' as const;

export const BLS_LAU_MONTHLY_STATISTICAL_DISCLAIMER =
  'Local Area Unemployment Statistics (LAU) are monthly model-based and survey benchmark estimates of civilian labor force, resident employment, resident unemployment, and unemployment rate. They measure resident status and do not represent payroll job counts by business establishment location, real-time unemployment claims, or individual worker applicant records.' as const;

export const BlsLauMeasureCodeSchema = z.enum(['03', '04', '05', '06']);
export type BlsLauMeasureCode = z.infer<typeof BlsLauMeasureCodeSchema>;

export const BlsLauVariableIdSchema = z.enum([
  'LAU_LABOR_FORCE',
  'LAU_EMPLOYED',
  'LAU_UNEMPLOYED',
  'LAU_RATE',
]);
export type BlsLauVariableId = z.infer<typeof BlsLauVariableIdSchema>;

export const BlsLauSeasonalCodeSchema = z.enum(['U', 'S']);
export type BlsLauSeasonalCode = z.infer<typeof BlsLauSeasonalCodeSchema>;

export const BlsLauPeriodSchema = z
  .string()
  .min(3)
  .max(3)
  .regex(/^M(?:0[1-9]|1[0-2]|13)$/, 'LAU period must be M01-M12 (monthly) or M13 (annual average)');
export type BlsLauPeriod = z.infer<typeof BlsLauPeriodSchema>;

export const BlsLauYearSchema = z
  .string()
  .min(4)
  .max(4)
  .regex(/^20[0-9]{2}$/, 'Year must be a 4-digit year (e.g. 2026)');
export type BlsLauYear = z.infer<typeof BlsLauYearSchema>;

export const BlsLauSeriesIdSchema = z
  .string()
  .min(17)
  .max(20)
  .regex(
    /^LA[US][A-Z0-9]{14,17}$/,
    'LAU series ID must start with LA[U|S] followed by area and measure codes'
  );
export type BlsLauSeriesId = z.infer<typeof BlsLauSeriesIdSchema>;

export const BlsLauUnitSchema = z.enum(['count', 'percent', 'ratio']);
export type BlsLauUnit = z.infer<typeof BlsLauUnitSchema>;

export const BlsLauVariableDefinitionSchema = z
  .object({
    variable_id: BlsLauVariableIdSchema,
    measure_code: BlsLauMeasureCodeSchema,
    metric_id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9-]+$/, 'metric_id must be lowercase alphanumeric with hyphens'),
    label: z.string().min(1).max(256),
    statistical_definition: z.string().min(1).max(1000),
    universe: z.string().min(1).max(256),
    unit: BlsLauUnitSchema,
    supported_geographies: z.array(z.string().min(1).max(32)).min(1),
    tags: z.array(z.string().min(1).max(64)).max(16),
  })
  .strict();
export type BlsLauVariableDefinition = z.infer<typeof BlsLauVariableDefinitionSchema>;

export const BlsLauVariableDictionarySchema = z
  .object({
    schema_version: z.literal(BLS_LAU_SCHEMA_VERSION),
    version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Version must follow semver X.Y.Z'),
    program: z.literal('lau'),
    monthly_disclaimer: z.literal(BLS_LAU_MONTHLY_STATISTICAL_DISCLAIMER),
    vintages_supported: z.array(z.string().min(4).max(64)).min(1),
    variables: z.record(z.string(), BlsLauVariableDefinitionSchema),
  })
  .strict();
export type BlsLauVariableDictionary = z.infer<typeof BlsLauVariableDictionarySchema>;

export const BlsLauQueryGeographySchema = EconomicGeographySchema.superRefine((geo, ctx) => {
  const allowedLevels = ['county', 'cbsa', 'state', 'nation'];
  if (!allowedLevels.includes(geo.level)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['level'],
      message: `BLS LAU queries support geographies: ${allowedLevels.join(', ')}. Received '${geo.level}'`,
    });
  }
});

export const BlsLauQuerySchema = z
  .object({
    geography: BlsLauQueryGeographySchema,
    measures: z.array(BlsLauMeasureCodeSchema).max(4).optional(),
    variables: z.array(z.string().min(1).max(64)).max(10).optional(),
    period: BlsLauPeriodSchema.optional(),
    year: BlsLauYearSchema.optional(),
    seasonal: BlsLauSeasonalCodeSchema.optional(),
    vintage: z.string().min(4).max(64).optional(),
    is_registered: z.boolean().optional(),
  })
  .passthrough()
  .superRefine((val, ctx) => {
    const knownKeys = new Set([
      'geography',
      'measures',
      'variables',
      'period',
      'year',
      'seasonal',
      'vintage',
      'is_registered',
    ]);
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

    // Enforce rate limits: unregistered max 10 series/variables, registered max 50 series
    const maxVars = val.is_registered
      ? BLS_API_LIMITS_REGISTERED.max_series_per_query
      : BLS_API_LIMITS_UNREGISTERED.max_series_per_query;
    const requestedCount = (val.variables?.length ?? 0) + (val.measures?.length ?? 0);
    if (requestedCount > maxVars) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['variables'],
        message: `Requested ${requestedCount} variables/measures exceeds BLS API limit of ${maxVars} for ${val.is_registered ? 'registered' : 'unregistered'} queries`,
      });
    }
  });
export type BlsLauQuery = z.infer<typeof BlsLauQuerySchema>;

export const BlsLauRawCellSchema = z.union([z.string(), z.number(), z.null(), z.undefined()]);
export type BlsLauRawCell = z.infer<typeof BlsLauRawCellSchema>;
