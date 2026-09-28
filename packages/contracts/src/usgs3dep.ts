import { z } from 'zod';
import { EconomicEstimateSchema } from './economic.js';
import { DataProvenanceSchema } from './provenance.js';

// ============================================================================
// USGS 3DEP & EPQS Contracts (PLAN.md §10 Task 11.2 & ADR 0063)
// ============================================================================

export const USGS_3DEP_SCHEMA_VERSION = 1 as const;
export const USGS_3DEP_DEFAULT_VINTAGE = '3DEP 1/3 arc-second (2024)' as const;

export const USGS_3DEP_ADVISORY_DISCLAIMER =
  'USGS 3DEP elevation data retrieved via the Elevation Point Query Service (EPQS) is provided for geospatial reference, preliminary screening, and terrain modeling. It does not replace licensed boundary, topographic, or geotechnical land surveys, and must not be used as official Elevation Certificates for FEMA National Flood Insurance Program (NFIP) rating or structural engineering design.' as const;

/**
 * Modern EPQS REST endpoint. The legacy pqs.php URL is retired and prohibited.
 */
export const USGS_3DEP_MODERN_EPQS_URL = 'https://epqs.nationalmap.gov/v1/json' as const;
export const USGS_3DEP_RETIRED_ENDPOINT_SUBSTRING = 'pqs.php' as const;

/**
 * Sentinel value returned by USGS EPQS when elevation is unavailable or off-coverage (e.g. oceans).
 */
export const USGS_EPQS_OFF_COVERAGE_SENTINEL = -1000000 as const;

// ============================================================================
// Vertical Datums and Elevation Units
// ============================================================================

export const Usgs3DepVerticalDatumSchema = z.enum([
  'NAVD88',
  'NAD83',
  'WGS84',
  'local_mean_sea_level',
  'unknown',
]);
export type Usgs3DepVerticalDatum = z.infer<typeof Usgs3DepVerticalDatumSchema>;

export const Usgs3DepElevationUnitSchema = z.enum(['Meters', 'Feet']);
export type Usgs3DepElevationUnit = z.infer<typeof Usgs3DepElevationUnitSchema>;

// ============================================================================
// Raw USGS EPQS Wire Schemas (https://epqs.nationalmap.gov/v1/json)
// ============================================================================

export const RawUsgsEpqsQuerySchema = z
  .object({
    x: z.union([z.number(), z.string()]),
    y: z.union([z.number(), z.string()]),
    Data_Source: z.string(),
    Units: z.string(),
    Elevation: z.union([z.number(), z.string()]).nullable().optional(),
  })
  .passthrough();
export type RawUsgsEpqsQuery = z.infer<typeof RawUsgsEpqsQuerySchema>;

export const RawUsgsEpqsResponseSchema = z
  .object({
    USGS_Elevation_Point_Query_Service: z.object({
      Elevation_Query: RawUsgsEpqsQuerySchema,
    }),
  })
  .passthrough();
export type RawUsgsEpqsResponse = z.infer<typeof RawUsgsEpqsResponseSchema>;

// ============================================================================
// Normalized Point Query
// ============================================================================

export const Usgs3DepPointQuerySchema = z
  .object({
    x: z.number().finite().min(-180).max(180),
    y: z.number().finite().min(-90).max(90),
    units: Usgs3DepElevationUnitSchema.default('Meters'),
  })
  .strict();
export type Usgs3DepPointQuery = z.infer<typeof Usgs3DepPointQuerySchema>;

// ============================================================================
// Normalized Elevation Point Result
// ============================================================================

export const Usgs3DepElevationPointResultSchema = z
  .object({
    point: z
      .object({
        x: z.number().finite().min(-180).max(180),
        y: z.number().finite().min(-90).max(90),
      })
      .strict(),
    elevation: EconomicEstimateSchema,
    elevation_meters: EconomicEstimateSchema,
    elevation_feet: EconomicEstimateSchema,
    data_source: z.string().min(1).max(128),
    vertical_datum: Usgs3DepVerticalDatumSchema,
    query_units: Usgs3DepElevationUnitSchema,
    is_off_coverage: z.boolean(),
    provenance: DataProvenanceSchema,
    advisory_disclaimer: z.literal(USGS_3DEP_ADVISORY_DISCLAIMER),
  })
  .strict()
  .superRefine((val, ctx) => {
    // Non-coercion invariant: off-coverage points (-1000000 or null) must NEVER be coerced to available / 0.0 sea level
    if (val.is_off_coverage) {
      if (val.elevation.status === 'available') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['elevation', 'status'],
          message:
            'Non-coercion law: off-coverage elevation must evaluate to unavailable, never available or 0.0 sea level',
        });
      }
      if (val.elevation_meters.status === 'available') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['elevation_meters', 'status'],
          message:
            'Non-coercion law: off-coverage elevation_meters must evaluate to unavailable, never available',
        });
      }
      if (val.elevation_feet.status === 'available') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['elevation_feet', 'status'],
          message:
            'Non-coercion law: off-coverage elevation_feet must evaluate to unavailable, never available',
        });
      }
    }
  });
export type Usgs3DepElevationPointResult = z.infer<typeof Usgs3DepElevationPointResultSchema>;

// ============================================================================
// Terrain Slope & Profile Contracts
// ============================================================================

export const Usgs3DepSlopeResultSchema = z
  .object({
    start_point: z
      .object({
        x: z.number().finite().min(-180).max(180),
        y: z.number().finite().min(-90).max(90),
      })
      .strict(),
    end_point: z
      .object({
        x: z.number().finite().min(-180).max(180),
        y: z.number().finite().min(-90).max(90),
      })
      .strict(),
    horizontal_distance_meters: z.number().finite().nonnegative(),
    elevation_change_meters: EconomicEstimateSchema,
    slope_percent: EconomicEstimateSchema,
    slope_degrees: EconomicEstimateSchema,
    provenance: DataProvenanceSchema,
    advisory_disclaimer: z.literal(USGS_3DEP_ADVISORY_DISCLAIMER),
  })
  .strict();
export type Usgs3DepSlopeResult = z.infer<typeof Usgs3DepSlopeResultSchema>;

// ============================================================================
// Synthetic Fixtures Contracts
// ============================================================================

export const Usgs3DepPointFixtureSchema = z
  .object({
    location_name: z.string().min(1).max(128),
    x: z.number().finite().min(-180).max(180),
    y: z.number().finite().min(-90).max(90),
    elevation: EconomicEstimateSchema,
    elevation_meters: EconomicEstimateSchema,
    elevation_feet: EconomicEstimateSchema,
    data_source: z.string().min(1).max(128),
    units: Usgs3DepElevationUnitSchema,
    vertical_datum: Usgs3DepVerticalDatumSchema,
    is_off_coverage: z.boolean(),
  })
  .strict();
export type Usgs3DepPointFixture = z.infer<typeof Usgs3DepPointFixtureSchema>;

export const Usgs3DepFixtureDatasetSchema = z
  .object({
    schema_version: z.literal(USGS_3DEP_SCHEMA_VERSION),
    fixture_id: z.literal('usgs-3dep-synthetic-v1'),
    source_id: z.literal('usgs-3dep'),
    title: z.string().min(1).max(256),
    description: z.string().min(1).max(1000),
    provenance: DataProvenanceSchema,
    points: z.array(Usgs3DepPointFixtureSchema).min(1),
  })
  .strict();
export type Usgs3DepFixtureDataset = z.infer<typeof Usgs3DepFixtureDatasetSchema>;
