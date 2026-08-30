import { z } from 'zod';
import { DataProvenanceSchema } from './provenance.js';

export const CABLE_CATALOG_SCHEMA_VERSION = 1 as const;
export const CABLE_PACK_MANIFEST_SCHEMA_VERSION = 1 as const;

export const MAX_CABLE_ROUTES = 2_000;
export const MAX_CABLE_LANDING_POINTS = 5_000;
export const MAX_CABLE_ROUTE_SEGMENTS = 5_000;
export const MAX_CABLE_COORDINATES = 100_000;

const CableIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/, 'cable identifiers must be lowercase literals');

const IsoTimestampSchema = z.string().datetime({ offset: true });

export const CableCoordinateSchema = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);
export type CableCoordinate = z.infer<typeof CableCoordinateSchema>;

export const CableLandingPointSchema = z
  .object({
    id: CableIdentifierSchema,
    name: z.string().min(1).max(200),
    country: z.string().min(1).max(120),
    longitude: z.number().finite().min(-180).max(180),
    latitude: z.number().finite().min(-90).max(90),
  })
  .strict();
export type CableLandingPoint = z.infer<typeof CableLandingPointSchema>;

export const CableRouteSchema = z
  .object({
    id: CableIdentifierSchema,
    name: z.string().min(1).max(200),
    status: z.enum(['active', 'planned', 'retired', 'unknown']),
    owners: z.array(z.string().min(1).max(200)).max(50),
    rfs_year: z.number().int().min(1850).max(2200).nullable(),
    length_km: z.number().finite().positive().max(100_000).nullable(),
    landing_point_ids: z.array(CableIdentifierSchema).min(2).max(100),
    segments: z.array(z.array(CableCoordinateSchema).min(2).max(4_096)).min(1).max(64),
  })
  .strict();
export type CableRoute = z.infer<typeof CableRouteSchema>;

const CableCatalogFieldsSchema = z
  .object({
    schema_version: z.literal(CABLE_CATALOG_SCHEMA_VERSION),
    catalog_id: CableIdentifierSchema,
    observed_at: IsoTimestampSchema,
    vintage: z.string().min(1).max(200),
    landing_points: z.array(CableLandingPointSchema).max(MAX_CABLE_LANDING_POINTS),
    routes: z.array(CableRouteSchema).max(MAX_CABLE_ROUTES),
  })
  .strict();

function validateCableCatalog(
  catalog: z.infer<typeof CableCatalogFieldsSchema>,
  ctx: z.RefinementCtx
): void {
  const landingPointIds = new Set<string>();
  for (const [index, landingPoint] of catalog.landing_points.entries()) {
    if (landingPointIds.has(landingPoint.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['landing_points', index, 'id'],
        message: `duplicate cable landing-point ID: ${landingPoint.id}`,
      });
    }
    landingPointIds.add(landingPoint.id);
  }

  const routeIds = new Set<string>();
  let segmentCount = 0;
  let coordinateCount = 0;
  for (const [routeIndex, route] of catalog.routes.entries()) {
    if (routeIds.has(route.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['routes', routeIndex, 'id'],
        message: `duplicate cable route ID: ${route.id}`,
      });
    }
    routeIds.add(route.id);

    for (const [landingIndex, landingPointId] of route.landing_point_ids.entries()) {
      if (!landingPointIds.has(landingPointId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['routes', routeIndex, 'landing_point_ids', landingIndex],
          message: `unknown cable landing-point ID: ${landingPointId}`,
        });
      }
    }

    segmentCount += route.segments.length;
    coordinateCount += route.segments.reduce((total, segment) => total + segment.length, 0);
  }

  if (segmentCount > MAX_CABLE_ROUTE_SEGMENTS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['routes'],
      message: `cable catalog exceeds ${MAX_CABLE_ROUTE_SEGMENTS} total route segments`,
    });
  }
  if (coordinateCount > MAX_CABLE_COORDINATES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['routes'],
      message: `cable catalog exceeds ${MAX_CABLE_COORDINATES} total coordinates`,
    });
  }
}

export const CableCatalogSchema = CableCatalogFieldsSchema.superRefine(validateCableCatalog);
export type CableCatalog = z.infer<typeof CableCatalogSchema>;

export const CableCatalogResponseSchema = CableCatalogFieldsSchema.extend({
  provenance: DataProvenanceSchema,
}).superRefine(validateCableCatalog);
export type CableCatalogResponse = z.infer<typeof CableCatalogResponseSchema>;

export const CablePackManifestSchema = z
  .object({
    schema_version: z.literal(CABLE_PACK_MANIFEST_SCHEMA_VERSION),
    pack_id: CableIdentifierSchema,
    format: z.literal('gev-cable-catalog-v1'),
    download_url: z.string().url(),
    allowed_host: z
      .string()
      .min(1)
      .max(253)
      .regex(/^[a-z0-9.-]+$/, 'pack host must be a lowercase DNS name'),
    allowed_path_prefix: z.string().min(1).max(500).regex(/^\//),
    expected_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    max_bytes: z
      .number()
      .int()
      .positive()
      .max(25 * 1024 * 1024),
    timeout_ms: z.number().int().min(1_000).max(30_000),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const url = new URL(manifest.download_url);
    if (url.protocol !== 'https:') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['download_url'],
        message: 'cable packs require HTTPS',
      });
    }
    if (url.hostname.toLowerCase() !== manifest.allowed_host) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allowed_host'],
        message: 'pack host must exactly match the configured download URL',
      });
    }
    if (!url.pathname.startsWith(manifest.allowed_path_prefix)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allowed_path_prefix'],
        message: 'pack URL is outside the configured path prefix',
      });
    }
  });
export type CablePackManifest = z.infer<typeof CablePackManifestSchema>;

export const CablePackActivationRequestSchema = z
  .object({ pack_id: CableIdentifierSchema })
  .strict();
export type CablePackActivationRequest = z.infer<typeof CablePackActivationRequestSchema>;

export const CablePackActivationResponseSchema = z.object({
  activated: z.boolean(),
  pack_id: CableIdentifierSchema,
  operation_id: z.string().uuid(),
  mode: z.enum(['seed', 'download_pack']),
  route_count: z.number().int().nonnegative().max(MAX_CABLE_ROUTES),
  landing_point_count: z.number().int().nonnegative().max(MAX_CABLE_LANDING_POINTS),
  provenance: DataProvenanceSchema,
});
export type CablePackActivationResponse = z.infer<typeof CablePackActivationResponseSchema>;
