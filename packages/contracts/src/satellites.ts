import { z } from 'zod';
import { DataProvenanceSchema } from './provenance.js';

export const SATELLITE_SCHEMA_VERSION = 1 as const;
export const MAX_SATELLITE_RECORDS = 1_000;
export const SATELLITE_USAGE_NOTICE =
  'Propagated estimate from orbital elements; not live and not for navigation, conjunction assessment, or collision avoidance.';

const IsoTimestampSchema = z.string().datetime({ offset: true });

export const SatelliteCatalogIdSchema = z.union([
  z.string().regex(/^\d{1,9}$/, 'catalog IDs must contain 1 to 9 digits'),
  z.string().regex(/^synthetic-\d{3}$/, 'synthetic catalog IDs must use synthetic-NNN'),
]);
export type SatelliteCatalogId = z.infer<typeof SatelliteCatalogIdSchema>;

export const SatelliteSourceGroupSchema = z.enum([
  'stations',
  'weather',
  'gps-ops',
  'geo',
  'synthetic',
]);
export type SatelliteSourceGroup = z.infer<typeof SatelliteSourceGroupSchema>;

const Degrees360Schema = z.number().finite().min(0).lt(360);

export const SatelliteOrbitalElementSchema = z
  .object({
    catalog_id: SatelliteCatalogIdSchema,
    object_name: z.string().trim().min(1).max(160),
    object_id: z.string().trim().min(1).max(32).nullable(),
    source_group: SatelliteSourceGroupSchema,
    element_epoch: IsoTimestampSchema,
    mean_motion_rev_per_day: z.number().finite().positive().max(20),
    eccentricity: z.number().finite().min(0).lt(1),
    inclination_deg: z.number().finite().min(0).max(180),
    right_ascension_deg: Degrees360Schema,
    argument_of_pericenter_deg: Degrees360Schema,
    mean_anomaly_deg: Degrees360Schema,
    ephemeris_type: z.literal(0),
    classification_type: z.enum(['U', 'C']),
    element_set_number: z.number().int().nonnegative().max(99_999),
    revolution_at_epoch: z.number().int().nonnegative().max(999_999_999).nullable(),
    bstar: z.number().finite().min(-10).max(10),
    mean_motion_dot: z.number().finite().min(-100).max(100),
    mean_motion_ddot: z.number().finite().min(-100).max(100),
    is_synthetic: z.boolean(),
  })
  .strict()
  .superRefine((element, ctx) => {
    const syntheticId = element.catalog_id.startsWith('synthetic-');
    const syntheticGroup = element.source_group === 'synthetic';
    if (element.is_synthetic !== syntheticId || element.is_synthetic !== syntheticGroup) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['is_synthetic'],
        message: 'synthetic identity, group, and flag must agree',
      });
    }
  });
export type SatelliteOrbitalElement = z.infer<typeof SatelliteOrbitalElementSchema>;

const SatelliteCatalogFieldsSchema = z
  .object({
    schema_version: z.literal(SATELLITE_SCHEMA_VERSION),
    catalog_id: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/),
    groups: z.array(SatelliteSourceGroupSchema).min(1).max(4),
    elements: z.array(SatelliteOrbitalElementSchema).min(1).max(MAX_SATELLITE_RECORDS),
  })
  .strict();

function validateSatelliteCatalog(
  catalog: z.infer<typeof SatelliteCatalogFieldsSchema>,
  ctx: z.RefinementCtx
): void {
  const groupSet = new Set(catalog.groups);
  if (groupSet.size !== catalog.groups.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['groups'],
      message: 'satellite catalog groups must be unique',
    });
  }

  const catalogIds = new Set<string>();
  for (const [index, element] of catalog.elements.entries()) {
    if (!groupSet.has(element.source_group)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['elements', index, 'source_group'],
        message: `element group '${element.source_group}' is absent from catalog groups`,
      });
    }
    if (catalogIds.has(element.catalog_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['elements', index, 'catalog_id'],
        message: `duplicate satellite catalog ID: ${element.catalog_id}`,
      });
    }
    catalogIds.add(element.catalog_id);
  }

  const hasSynthetic = groupSet.has('synthetic');
  if (
    hasSynthetic &&
    (groupSet.size !== 1 || catalog.elements.some((item) => !item.is_synthetic))
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['groups'],
      message: 'synthetic catalogs cannot mix live-source groups or records',
    });
  }
}

export const SatelliteCatalogSchema =
  SatelliteCatalogFieldsSchema.superRefine(validateSatelliteCatalog);
export type SatelliteCatalog = z.infer<typeof SatelliteCatalogSchema>;

export const SatelliteCatalogResponseSchema = SatelliteCatalogFieldsSchema.extend({
  provenance: DataProvenanceSchema,
}).superRefine(validateSatelliteCatalog);
export type SatelliteCatalogResponse = z.infer<typeof SatelliteCatalogResponseSchema>;

export const SatellitePropagatedStateSchema = z
  .object({
    catalog_id: SatelliteCatalogIdSchema,
    object_name: z.string().trim().min(1).max(160),
    object_id: z.string().trim().min(1).max(32).nullable(),
    source_group: SatelliteSourceGroupSchema,
    element_epoch: IsoTimestampSchema,
    propagated_at: IsoTimestampSchema,
    propagation_method: z.literal('sgp4'),
    is_estimate: z.literal(true),
    longitude_deg: z.number().finite().min(-180).max(180),
    latitude_deg: z.number().finite().min(-90).max(90),
    altitude_m: z.number().finite().nonnegative().max(100_000_000),
    speed_mps: z.number().finite().nonnegative().max(20_000),
  })
  .strict();
export type SatellitePropagatedState = z.infer<typeof SatellitePropagatedStateSchema>;

const SatellitePropagationBatchFieldsSchema = z
  .object({
    schema_version: z.literal(SATELLITE_SCHEMA_VERSION),
    catalog_id: z.string().min(1).max(128),
    groups: z.array(SatelliteSourceGroupSchema).min(1).max(4),
    propagated_at: IsoTimestampSchema,
    coordinate_frame: z.literal('wgs84-geodetic'),
    propagation_method: z.literal('sgp4'),
    is_estimate: z.literal(true),
    usage_notice: z.literal(SATELLITE_USAGE_NOTICE),
    states: z.array(SatellitePropagatedStateSchema).min(1).max(MAX_SATELLITE_RECORDS),
    provenance: DataProvenanceSchema,
  })
  .strict();

export const SatellitePropagationBatchSchema = SatellitePropagationBatchFieldsSchema.superRefine(
  (batch, ctx) => {
    const ids = new Set<string>();
    for (const [index, state] of batch.states.entries()) {
      if (state.propagated_at !== batch.propagated_at) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['states', index, 'propagated_at'],
          message: 'every state must use the batch propagation time',
        });
      }
      if (ids.has(state.catalog_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['states', index, 'catalog_id'],
          message: `duplicate propagated satellite ID: ${state.catalog_id}`,
        });
      }
      ids.add(state.catalog_id);
    }
  }
);
export type SatellitePropagationBatch = z.infer<typeof SatellitePropagationBatchSchema>;
