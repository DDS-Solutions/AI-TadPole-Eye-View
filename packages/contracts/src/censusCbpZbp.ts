import { z } from 'zod';
import { EconomicGeographySchema } from './economic.js';

// ============================================================================
// Census CBP & ZBP Contracts (PLAN.md §10 Task 9.2 & ADR 0052)
// ============================================================================

export const CENSUS_CBP_SCHEMA_VERSION = 1 as const;
export const CENSUS_CBP_DEFAULT_VINTAGE = '2023' as const;

export const CENSUS_CBP_ANNUAL_STATISTICAL_DISCLAIMER =
  'County Business Patterns (CBP) and ZIP Code Business Patterns (ZBP) are annual statistical benchmark estimates derived from administrative records and business register surveys, not real-time operational headcounts, exact current payroll records, or commercial credit evaluations.' as const;

export const CensusCbpVariableIdSchema = z.enum(['ESTAB', 'EMP', 'PAYANN', 'PAYQTR1']);
export type CensusCbpVariableId = z.infer<typeof CensusCbpVariableIdSchema>;

export const CensusCbpEmploymentNoiseFlagSchema = z.enum([
  'a', // 0 to 19
  'b', // 20 to 99
  'c', // 100 to 249
  'e', // 250 to 499
  'f', // 500 to 999
  'g', // 1,000 to 2,499
  'h', // 2,500 to 4,999
  'i', // 5,000 to 9,999
  'j', // 10,000 to 24,999
  'k', // 25,000 to 49,999
  'l', // 50,000 to 99,999
  'm', // 100,000 or more
]);
export type CensusCbpEmploymentNoiseFlag = z.infer<typeof CensusCbpEmploymentNoiseFlagSchema>;

export interface CensusCbpEmploymentNoiseBounds {
  readonly flag: CensusCbpEmploymentNoiseFlag;
  readonly lower_bound: number;
  readonly upper_bound?: number;
  readonly description: string;
}

export const CENSUS_CBP_EMPLOYMENT_NOISE_BOUNDS: Record<
  CensusCbpEmploymentNoiseFlag,
  CensusCbpEmploymentNoiseBounds
> = {
  a: { flag: 'a', lower_bound: 0, upper_bound: 19, description: '0 to 19 employees' },
  b: { flag: 'b', lower_bound: 20, upper_bound: 99, description: '20 to 99 employees' },
  c: { flag: 'c', lower_bound: 100, upper_bound: 249, description: '100 to 249 employees' },
  e: { flag: 'e', lower_bound: 250, upper_bound: 499, description: '250 to 499 employees' },
  f: { flag: 'f', lower_bound: 500, upper_bound: 999, description: '500 to 999 employees' },
  g: { flag: 'g', lower_bound: 1000, upper_bound: 2499, description: '1,000 to 2,499 employees' },
  h: { flag: 'h', lower_bound: 2500, upper_bound: 4999, description: '2,500 to 4,999 employees' },
  i: { flag: 'i', lower_bound: 5000, upper_bound: 9999, description: '5,000 to 9,999 employees' },
  j: {
    flag: 'j',
    lower_bound: 10000,
    upper_bound: 24999,
    description: '10,000 to 24,999 employees',
  },
  k: {
    flag: 'k',
    lower_bound: 25000,
    upper_bound: 49999,
    description: '25,000 to 49,999 employees',
  },
  l: {
    flag: 'l',
    lower_bound: 50000,
    upper_bound: 99999,
    description: '50,000 to 99,999 employees',
  },
  m: { flag: 'm', lower_bound: 100000, description: '100,000 or more employees' },
};

export const CensusCbpUnitSchema = z.enum(['count', 'USD_thousands', 'ratio']);
export type CensusCbpUnit = z.infer<typeof CensusCbpUnitSchema>;

export const CensusCbpVariableDefinitionSchema = z
  .object({
    variable_id: CensusCbpVariableIdSchema,
    metric_id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9-]+$/, 'metric_id must be lowercase alphanumeric with hyphens'),
    label: z.string().min(1).max(256),
    statistical_definition: z.string().min(1).max(1000),
    universe: z.string().min(1).max(256),
    unit: CensusCbpUnitSchema,
    supported_geographies: z.array(z.string().min(1).max(32)).min(1),
    tags: z.array(z.string().min(1).max(64)).max(16),
  })
  .strict();
export type CensusCbpVariableDefinition = z.infer<typeof CensusCbpVariableDefinitionSchema>;

export const CensusCbpVariableDictionarySchema = z
  .object({
    schema_version: z.literal(CENSUS_CBP_SCHEMA_VERSION),
    version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Version must follow semver X.Y.Z'),
    program: z.literal('cbp_zbp'),
    annual_disclaimer: z.literal(CENSUS_CBP_ANNUAL_STATISTICAL_DISCLAIMER),
    vintages_supported: z.array(z.string().min(4).max(64)).min(1),
    variables: z.record(z.string(), CensusCbpVariableDefinitionSchema),
  })
  .strict();
export type CensusCbpVariableDictionary = z.infer<typeof CensusCbpVariableDictionarySchema>;

export const CensusCbpNaicsCodeSchema = z
  .string()
  .min(2)
  .max(6)
  .regex(/^[0-9]{2,6}$/, 'NAICS code must be 2 to 6 numeric digits');
export type CensusCbpNaicsCode = z.infer<typeof CensusCbpNaicsCodeSchema>;

export const CensusCbpVintageSchema = z
  .string()
  .min(4)
  .max(64)
  .regex(
    /^(?:20[0-9]{2})(?:\s.+)?$/,
    'CBP vintage must be a 4-digit release year (YYYY) with optional release description'
  );
export type CensusCbpVintage = z.infer<typeof CensusCbpVintageSchema>;

export const CensusCbpQueryGeographySchema = EconomicGeographySchema.superRefine((geo, ctx) => {
  const allowedLevels = ['county', 'zcta', 'state', 'nation', 'cbsa'];
  if (!allowedLevels.includes(geo.level)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['level'],
      message: `CBP/ZBP queries support geographies: ${allowedLevels.join(', ')}. Received '${geo.level}'`,
    });
  }
});

export const CensusCbpQuerySchema = z
  .object({
    geography: CensusCbpQueryGeographySchema,
    naics_code: CensusCbpNaicsCodeSchema.optional(),
    variables: z
      .array(z.string().min(1).max(64))
      .max(20, 'Cannot request more than 20 variables in a single query')
      .optional(),
    vintage: CensusCbpVintageSchema.optional(),
  })
  .strict();
export type CensusCbpQuery = z.infer<typeof CensusCbpQuerySchema>;

export const CensusCbpRawCellSchema = z.union([z.string(), z.number(), z.null(), z.undefined()]);
export type CensusCbpRawCell = z.infer<typeof CensusCbpRawCellSchema>;
