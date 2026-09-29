import type { BoundingBox, OverpassSanitizationResult } from '@gev/contracts';
import { OverpassSanitizationError } from './errors.js';

export interface OverpassSanitizerOptions {
  maxTimeoutSec?: number;
  defaultTimeoutSec?: number;
  maxBboxSpanDeg?: number;
  fallbackBbox?: BoundingBox;
}

// ReDoS regex pattern detector (nested or multiple unbounded quantifiers)
const REDOS_PATTERN = /(\([^)]*[+*]\)[+*]|\([a-z0-9|]*\+[^)]*\)\+)/i;

export const MAX_OVERPASS_BBOX_SPAN_DEG = 5.0;
export const MAX_OVERPASS_QUERY_LENGTH = 10_000;
export const MAX_OVERPASS_STATEMENTS = 50;
export const MAX_OVERPASS_TIMEOUT_SEC = 25;

/**
 * Overpass QL Query Sanitizer (PLAN.md §10 Phase 1 Item 4)
 * Cleans, validates, and bounds OpenStreetMap Overpass QL queries.
 */
export function sanitizeOverpassQuery(
  rawQl: string,
  options: OverpassSanitizerOptions = {}
): OverpassSanitizationResult {
  const maxTimeoutSec = options.maxTimeoutSec ?? MAX_OVERPASS_TIMEOUT_SEC;
  const defaultTimeoutSec = options.defaultTimeoutSec ?? MAX_OVERPASS_TIMEOUT_SEC;
  const maxBboxSpanDeg = options.maxBboxSpanDeg ?? MAX_OVERPASS_BBOX_SPAN_DEG;

  if (!rawQl || typeof rawQl !== 'string') {
    throw new OverpassSanitizationError('Query must be a non-empty string', 'EMPTY_QUERY');
  }

  const trimmed = rawQl.trim();
  if (trimmed.length === 0) {
    throw new OverpassSanitizationError('Query must be non-empty', 'EMPTY_QUERY');
  }

  if (trimmed.length > MAX_OVERPASS_QUERY_LENGTH) {
    throw new OverpassSanitizationError(
      `Query length (${trimmed.length}) exceeds maximum allowable ${MAX_OVERPASS_QUERY_LENGTH} characters`,
      'QUERY_TOO_LARGE'
    );
  }

  // Check for ReDoS patterns in regex filters
  const regexMatches = trimmed.match(/~["']([^"']+)["']/g) || [];
  for (const m of regexMatches) {
    if (REDOS_PATTERN.test(m)) {
      throw new OverpassSanitizationError(
        `Potentially vulnerable ReDoS regular expression detected in filter: ${m}`,
        'REDOS_DETECTED'
      );
    }
  }

  // Count statements (semicolons)
  const statements = trimmed.split(';').filter((s) => s.trim().length > 0);
  if (statements.length > MAX_OVERPASS_STATEMENTS) {
    throw new OverpassSanitizationError(
      `Query contains ${statements.length} statements, exceeding maximum limit of ${MAX_OVERPASS_STATEMENTS}`,
      'EXCESSIVE_STATEMENTS'
    );
  }

  // Extract or inject timeout
  let timeoutSec = defaultTimeoutSec;
  const timeoutMatch = trimmed.match(/\[timeout:(\d+)\]/i);
  if (timeoutMatch?.[1]) {
    const parsed = Number.parseInt(timeoutMatch[1], 10);
    if (!Number.isNaN(parsed)) {
      timeoutSec = Math.max(1, Math.min(parsed, maxTimeoutSec));
    }
  }

  // Extract and validate ALL bounding boxes present: global [bbox:s,w,n,e] AND statement (s,w,n,e)
  let detectedBbox: BoundingBox | undefined = options.fallbackBbox;

  const globalBboxMatches = [
    ...trimmed.matchAll(/\[bbox:([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\]/gi),
  ];
  for (const m of globalBboxMatches) {
    if (m[1] && m[2] && m[3] && m[4]) {
      const s = Number.parseFloat(m[1]);
      const w = Number.parseFloat(m[2]);
      const n = Number.parseFloat(m[3]);
      const e = Number.parseFloat(m[4]);
      validateCoordinates(s, w, n, e, maxBboxSpanDeg);
      if (!detectedBbox) {
        detectedBbox = { min_lat: s, min_lon: w, max_lat: n, max_lon: e };
      }
    }
  }

  const stmtBboxMatches = [
    ...trimmed.matchAll(/\(([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\)/g),
  ];
  for (const m of stmtBboxMatches) {
    if (m[1] && m[2] && m[3] && m[4]) {
      const s = Number.parseFloat(m[1]);
      const w = Number.parseFloat(m[2]);
      const n = Number.parseFloat(m[3]);
      const e = Number.parseFloat(m[4]);
      validateCoordinates(s, w, n, e, maxBboxSpanDeg);
      if (!detectedBbox) {
        detectedBbox = { min_lat: s, min_lon: w, max_lat: n, max_lon: e };
      }
    }
  }

  if (!detectedBbox) {
    throw new OverpassSanitizationError(
      'Overpass queries require a bounding box constraint [bbox:s,w,n,e] or statement coordinate filter',
      'UNBOUNDED_QUERY'
    );
  }

  // Normalize query body by removing any existing timeout/out/bbox headers and statement-level coordinate filters
  // so that the injected sanitized bounding box header is strictly authoritative
  let cleanBody = trimmed
    .replace(/\[out:[^\]]+\];?/gi, '')
    .replace(/\[timeout:\d+\];?/gi, '')
    .replace(/\[bbox:[^\]]+\];?/gi, '')
    .replace(/\(([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\)/g, '')
    .trim();

  // If query doesn't end with semicolon, append it
  if (!cleanBody.endsWith(';')) {
    cleanBody += ';';
  }

  // Assemble standardized, secure Overpass QL
  const header = `[out:json][timeout:${timeoutSec}][bbox:${detectedBbox.min_lat},${detectedBbox.min_lon},${detectedBbox.max_lat},${detectedBbox.max_lon}];`;
  const sanitizedQl = `${header}\n${cleanBody}`;

  // Estimate query complexity score (1-100)
  const complexityScore = Math.min(
    100,
    Math.max(
      1,
      statements.length * 2 +
        regexMatches.length * 10 +
        Math.floor(
          (detectedBbox.max_lat - detectedBbox.min_lat) *
            (detectedBbox.max_lon - detectedBbox.min_lon) *
            2
        )
    )
  );

  return {
    sanitized_ql: sanitizedQl,
    timeout_sec: timeoutSec,
    bbox: detectedBbox,
    complexity_score: complexityScore,
  };
}

function validateCoordinates(s: number, w: number, n: number, e: number, maxSpanDeg: number): void {
  if (Number.isNaN(s) || Number.isNaN(w) || Number.isNaN(n) || Number.isNaN(e)) {
    throw new OverpassSanitizationError(
      'Bounding box coordinates must be valid numbers',
      'INVALID_BBOX'
    );
  }

  if (s < -90 || s > 90 || n < -90 || n > 90) {
    throw new OverpassSanitizationError(
      `Latitude out of bounds [-90, 90]: south=${s}, north=${n}`,
      'INVALID_BBOX'
    );
  }

  if (w < -180 || w > 180 || e < -180 || e > 180) {
    throw new OverpassSanitizationError(
      `Longitude out of bounds [-180, 180]: west=${w}, east=${e}`,
      'INVALID_BBOX'
    );
  }

  if (s > n) {
    throw new OverpassSanitizationError(
      `South latitude (${s}) cannot exceed North latitude (${n})`,
      'INVALID_BBOX'
    );
  }

  if (w > e) {
    throw new OverpassSanitizationError(
      `West longitude (${w}) cannot exceed East longitude (${e}) (antimeridian wrapping unsupported)`,
      'ANTIMERIDIAN_UNSUPPORTED'
    );
  }

  const latSpan = n - s;
  const lonSpan = e - w;

  if (latSpan > maxSpanDeg || lonSpan > maxSpanDeg) {
    throw new OverpassSanitizationError(
      `Bounding box span (${latSpan.toFixed(2)}° lat, ${lonSpan.toFixed(2)}° lon) exceeds maximum allowed ${maxSpanDeg}° span`,
      'BBOX_AREA_EXCEEDED'
    );
  }
}
