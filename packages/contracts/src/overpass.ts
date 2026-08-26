import { z } from 'zod';
import { BoundingBox } from './flight.js';

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
