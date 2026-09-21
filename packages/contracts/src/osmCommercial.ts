import { z } from 'zod';
import { EconomicEvidenceRecordSchema } from './economic.js';
import { DataProvenanceSchema } from './provenance.js';

// ============================================================================
// OpenStreetMap & ODbL Statutory Licensing Constants (PLAN.md §8.2, §9.3, OQ-5)
// ============================================================================

export const OSM_ODBL_LICENSE_ID = 'odbl-1.0' as const;
export const OSM_ODBL_LICENSE_NAME = 'Open Database License (ODbL) 1.0' as const;
export const OSM_ODBL_ATTRIBUTION = '© OpenStreetMap contributors (ODbL 1.0)' as const;
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright' as const;

export const OSM_ODBL_LEGAL_DISCLAIMER =
  'OpenStreetMap data is licensed under the Open Database License (ODbL) 1.0. Any public display or derivative database must visibly attribute © OpenStreetMap contributors and adhere to ODbL share-alike provisions.' as const;

// Extraction bounds to prevent server denial of service and bounded commercial area queries
export const OSM_COMMERCIAL_MAX_BBOX_SPAN_DEG = 0.5 as const;
export const OSM_COMMERCIAL_MAX_TIMEOUT_SEC = 25 as const;
export const OSM_COMMERCIAL_MAX_ELEMENTS = 5000 as const;
export const OSM_COMMERCIAL_MIN_REQUEST_INTERVAL_MS = 1000 as const;
export const OSM_COMMERCIAL_CACHE_TTL_SEC = 86400 as const;

export const OSM_COMMERCIAL_WHITELISTED_PRIMARY_KEYS = [
  'amenity',
  'shop',
  'craft',
  'office',
  'commercial',
  'tourism',
  'healthcare',
] as const;

// ============================================================================
// Commercial Categories
// ============================================================================

export const OsmCommercialCategorySchema = z.enum([
  'food_and_beverage',
  'retail',
  'services',
  'office',
  'craft_industrial',
  'healthcare',
  'hospitality',
  'other_commercial',
]);
export type OsmCommercialCategory = z.infer<typeof OsmCommercialCategorySchema>;

// ============================================================================
// Geographic Extraction Bounding Box
// ============================================================================

export const OsmCommercialBoundingBoxSchema = z
  .object({
    min_lat: z.number().finite().min(-90).max(90),
    min_lon: z.number().finite().min(-180).max(180),
    max_lat: z.number().finite().min(-90).max(90),
    max_lon: z.number().finite().min(-180).max(180),
    name: z.string().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.min_lat > b.max_lat) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['min_lat'],
        message: 'min_lat must not exceed max_lat',
      });
    }
    if (b.min_lon > b.max_lon) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['min_lon'],
        message: 'min_lon must not exceed max_lon (antimeridian wrapping unsupported)',
      });
    }
    const latSpan = b.max_lat - b.min_lat;
    const lonSpan = b.max_lon - b.min_lon;
    if (latSpan > OSM_COMMERCIAL_MAX_BBOX_SPAN_DEG) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['max_lat'],
        message: `Latitude span (${latSpan.toFixed(4)}°) exceeds maximum allowed ${OSM_COMMERCIAL_MAX_BBOX_SPAN_DEG}°`,
      });
    }
    if (lonSpan > OSM_COMMERCIAL_MAX_BBOX_SPAN_DEG) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['max_lon'],
        message: `Longitude span (${lonSpan.toFixed(4)}°) exceeds maximum allowed ${OSM_COMMERCIAL_MAX_BBOX_SPAN_DEG}°`,
      });
    }
  });
export type OsmCommercialBoundingBox = z.infer<typeof OsmCommercialBoundingBoxSchema>;

// ============================================================================
// Commercial Enrichment Query
// ============================================================================

export const OsmCommercialQuerySchema = z
  .object({
    bbox: OsmCommercialBoundingBoxSchema,
    categories: z.array(OsmCommercialCategorySchema).min(1).max(8).optional(),
    search_term: z.string().min(1).max(100).optional(),
  })
  .strict();
export type OsmCommercialQuery = z.infer<typeof OsmCommercialQuerySchema>;

// ============================================================================
// Extracted Commercial POI Feature
// ============================================================================

export const OsmCommercialPoiFeatureSchema = z
  .object({
    id: z.number().int(),
    type: z.enum(['node', 'way']),
    lat: z.number().finite().min(-90).max(90),
    lon: z.number().finite().min(-180).max(180),
    name: z.string().min(1).max(200),
    category: OsmCommercialCategorySchema,
    primary_tag: z.string().min(1).max(100),
    tags: z.record(z.string(), z.string()),
    brand: z.string().min(1).max(100).optional(),
    operator: z.string().min(1).max(100).optional(),
    opening_hours: z.string().min(1).max(100).optional(),
    cuisine: z.string().min(1).max(100).optional(),
  })
  .strict();
export type OsmCommercialPoiFeature = z.infer<typeof OsmCommercialPoiFeatureSchema>;

// ============================================================================
// Commercial Footprint & Density Summary
// ============================================================================

export const OsmCommercialTopAmenitySchema = z
  .object({
    tag: z.string().min(1).max(100),
    count: z.number().int().nonnegative(),
  })
  .strict();
export type OsmCommercialTopAmenity = z.infer<typeof OsmCommercialTopAmenitySchema>;

export const OsmCommercialFootprintSummarySchema = z
  .object({
    total_features: z.number().int().nonnegative(),
    category_counts: z.record(OsmCommercialCategorySchema, z.number().int().nonnegative()),
    density_per_km2: z.number().finite().nonnegative(),
    area_km2: z.number().finite().positive(),
    top_amenities: z.array(OsmCommercialTopAmenitySchema).max(20),
  })
  .strict();
export type OsmCommercialFootprintSummary = z.infer<typeof OsmCommercialFootprintSummarySchema>;

// ============================================================================
// Complete Commercial Enrichment Response Envelope
// ============================================================================

export const OsmCommercialEnrichmentResponseSchema = z
  .object({
    query: OsmCommercialQuerySchema,
    features: z.array(OsmCommercialPoiFeatureSchema).max(OSM_COMMERCIAL_MAX_ELEMENTS),
    summary: OsmCommercialFootprintSummarySchema,
    evidence_records: z.array(EconomicEvidenceRecordSchema).max(100),
    provenance: DataProvenanceSchema,
    disclaimer: z.literal(OSM_ODBL_LEGAL_DISCLAIMER),
  })
  .strict()
  .superRefine((data, ctx) => {
    // Fail-closed enforcement: mandatory ODbL attribution notice
    const attribution = data.provenance.attribution?.toLowerCase() ?? '';
    if (!attribution.includes('openstreetmap')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['provenance', 'attribution'],
        message:
          'OpenStreetMap commercial responses require explicit OpenStreetMap attribution notice',
      });
    }
    const licenseId = data.provenance.license?.id;
    if (licenseId !== 'odbl-1.0' && licenseId !== 'odbl-1-0') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['provenance', 'license', 'id'],
        message: 'OpenStreetMap commercial data must cite ODbL license (odbl-1.0)',
      });
    }
  });
export type OsmCommercialEnrichmentResponse = z.infer<typeof OsmCommercialEnrichmentResponseSchema>;
