import { z } from 'zod';
import { EconomicGeographyLevelSchema, EconomicGeographySchema } from './economic.js';

// ============================================================================
// Census ACS Variables & Dictionaries (PLAN.md §10 Task 9.1 & ADR 0052)
// ============================================================================

export const CENSUS_ACS_SCHEMA_VERSION = 1 as const;
export const CENSUS_ACS_DEFAULT_RELEASE = 'acs5' as const;
export const CENSUS_ACS_DEFAULT_VINTAGE = '2020-2024' as const;

export const CENSUS_ACS_FOREIGN_BORN_STATUTORY_DEFINITION =
  'Foreign-born population per statutory U.S. Census Bureau definitions (Table B05002). Under Census Bureau methodology, foreign-born includes all persons who were not U.S. citizens at birth, consisting of both naturalized U.S. citizens and non-citizens. It must not be conflated with non-citizens only.' as const;

export const CensusAcsVariableIdSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[A-Z0-9_]+$/, 'Census ACS variable IDs must be uppercase alphanumeric with underscores');
export type CensusAcsVariableId = z.infer<typeof CensusAcsVariableIdSchema>;

export const CensusAcsTableIdSchema = z
  .string()
  .min(1)
  .max(16)
  .regex(/^[A-Z0-9]+$/, 'Census ACS table IDs must be uppercase alphanumeric');
export type CensusAcsTableId = z.infer<typeof CensusAcsTableIdSchema>;

export const CensusAcsVintageSchema = z
  .string()
  .min(4)
  .max(64)
  .regex(
    /^(?:20[0-9]{2}|20[0-9]{2}-20[0-9]{2})(?:\s.+)?$/,
    'Vintage must be a 4-digit year (YYYY) or 5-year span (YYYY-YYYY) with optional release description'
  );
export type CensusAcsVintage = z.infer<typeof CensusAcsVintageSchema>;

export const CensusAcsUnitSchema = z.enum(['USD', 'count', 'ratio', 'percent', 'index']);
export type CensusAcsUnit = z.infer<typeof CensusAcsUnitSchema>;

export const CensusAcsVariableDefinitionSchema = z
  .object({
    variable_id: CensusAcsVariableIdSchema,
    moe_variable_id: CensusAcsVariableIdSchema.optional(),
    table_id: CensusAcsTableIdSchema,
    metric_id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9-]+$/, 'metric_id must be lowercase alphanumeric with hyphens'),
    label: z.string().min(1).max(256),
    concept: z.string().min(1).max(256),
    statistical_definition: z.string().min(1).max(1000),
    universe: z.string().min(1).max(256),
    unit: CensusAcsUnitSchema,
    supported_geographies: z.array(EconomicGeographyLevelSchema).min(1),
    tags: z.array(z.string().min(1).max(64)).max(16),
  })
  .strict()
  .superRefine((data, ctx) => {
    // Statutory verification: Table B05002 foreign-born population must preserve correct definitions
    if (data.table_id === 'B05002' && data.metric_id === 'foreign-born-population') {
      if (
        !data.statistical_definition.toLowerCase().includes('naturalized') ||
        !data.statistical_definition.toLowerCase().includes('non-citizen')
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['statistical_definition'],
          message:
            'Foreign-born definition under B05002 must explicitly include both naturalized citizens and non-citizens per statutory Census definitions',
        });
      }
    }
  });
export type CensusAcsVariableDefinition = z.infer<typeof CensusAcsVariableDefinitionSchema>;

export const CensusAcsVariableDictionarySchema = z
  .object({
    schema_version: z.literal(CENSUS_ACS_SCHEMA_VERSION),
    version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Version must follow semver X.Y.Z'),
    acs_release: z.literal('acs5'),
    vintages_supported: z.array(CensusAcsVintageSchema).min(1),
    variables: z.record(z.string(), CensusAcsVariableDefinitionSchema),
  })
  .strict();
export type CensusAcsVariableDictionary = z.infer<typeof CensusAcsVariableDictionarySchema>;

// ============================================================================
// Census ACS Query Contract
// ============================================================================

export const CensusAcsQueryGeographySchema = EconomicGeographySchema.superRefine((geo, ctx) => {
  const allowedLevels = ['county', 'tract', 'zcta', 'place', 'state', 'nation'];
  if (!allowedLevels.includes(geo.level)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['level'],
      message: `Census ACS queries support geographies: ${allowedLevels.join(', ')}. Received '${geo.level}'`,
    });
  }
});

export const CensusAcsQuerySchema = z
  .object({
    geography: CensusAcsQueryGeographySchema,
    variables: z
      .array(z.string().min(1).max(64))
      .min(1, 'At least one variable or metric identifier must be requested')
      .max(50, 'Cannot request more than 50 variables in a single query'),
    vintage: CensusAcsVintageSchema.optional(),
  })
  .strict();
export type CensusAcsQuery = z.infer<typeof CensusAcsQuerySchema>;

// ============================================================================
// Raw Census Ingestion Cell Contract (for zero numeric zero-coercion)
// ============================================================================

export const CensusAcsSpecialAnnotationCodeSchema = z.enum([
  '-666666666', // Estimate could not be computed (e.g. median in open-ended interval) -> small_sample
  '-888888888', // Not applicable / not available -> unavailable
  '-999999999', // Display threshold or suppressed -> data_quality
  '-555555555', // Controlled MOE / not applicable
]);
export type CensusAcsSpecialAnnotationCode = z.infer<typeof CensusAcsSpecialAnnotationCodeSchema>;

export const CensusAcsRawCellSchema = z.union([z.string(), z.number(), z.null(), z.undefined()]);
export type CensusAcsRawCell = z.infer<typeof CensusAcsRawCellSchema>;
