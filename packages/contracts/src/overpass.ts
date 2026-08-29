import { z } from 'zod';
import { BoundingBox } from './flight.js';
import { DataProvenanceSchema } from './provenance.js';

export const OverpassOutputFormat = z.enum(['json', 'xml', 'csv']);
export type OverpassOutputFormat = z.infer<typeof OverpassOutputFormat>;

/**
 * Overpass QL Query request envelope.
 */
export const OverpassQueryRequest = z.object({
  /** Overpass QL query string. */
  ql: z.string().min(1).max(10000),
  /** Maximum execution timeout allowed in seconds [1, 25]. */
  timeout_seconds: z.number().int().min(1).max(25).default(25),
  /** Optional bounding box constraint. */
  bbox: BoundingBox.optional(),
  /** Output data format. */
  format: OverpassOutputFormat.default('json'),
});
export type OverpassQueryRequest = z.infer<typeof OverpassQueryRequest>;

/**
 * Sanitized Overpass result payload.
 */
export const OverpassSanitizationResult = z.object({
  /** Cleaned, safety-normalized Overpass QL query string. */
  sanitized_ql: z.string(),
  /** Normalized timeout in seconds. */
  timeout_sec: z.number().int().min(1).max(25),
  /** Extracted bounding box if present. */
  bbox: BoundingBox.optional(),
  /** Estimated query complexity score (1-100). */
  complexity_score: z.number().int().min(1).max(100),
});
export type OverpassSanitizationResult = z.infer<typeof OverpassSanitizationResult>;

export const OverpassElementSchema = z
  .object({
    type: z.enum(['node', 'way', 'relation']),
    id: z.number().int(),
  })
  .passthrough();

export const OverpassResponsePayloadSchema = z
  .object({
    version: z.number(),
    generator: z.string().min(1),
    osm3s: z
      .object({
        timestamp_osm_base: z.string().optional(),
        copyright: z.string().optional(),
      })
      .passthrough(),
    elements: z.array(OverpassElementSchema),
    sanitization: z.object({
      complexity_score: z.number().int().min(1).max(100),
      timeout_sec: z.number().int().min(1).max(25),
    }),
  })
  .passthrough();
export type OverpassResponsePayload = z.infer<typeof OverpassResponsePayloadSchema>;

/** Complete validated response returned by the server boundary. */
export const OverpassResponseSchema = OverpassResponsePayloadSchema.extend({
  provenance: DataProvenanceSchema,
});
export type OverpassResponse = z.infer<typeof OverpassResponseSchema>;
