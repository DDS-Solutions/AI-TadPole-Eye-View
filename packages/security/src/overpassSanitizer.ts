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

/**
 * Overpass QL Query Sanitizer (PLAN.md §10 Phase 1 Item 4)
 * Cleans, validates, and bounds OpenStreetMap Overpass QL queries.
 */
export function sanitizeOverpassQuery(
  rawQl: string,
  options: OverpassSanitizerOptions = {}
): OverpassSanitizationResult {
  const maxTimeoutSec = options.maxTimeoutSec ?? 25;
  const defaultTimeoutSec = options.defaultTimeoutSec ?? 25;
  const maxBboxSpanDeg = options.maxBboxSpanDeg ?? 5.0;

  if (!rawQl || typeof rawQl !== 'string') {
    throw new OverpassSanitizationError('Query must be a non-empty string', 'EMPTY_QUERY');
  }

  const trimmed = rawQl.trim();
  if (trimmed.length === 0) {
    throw new OverpassSanitizationError('Query must be non-empty', 'EMPTY_QUERY');
  }

  if (trimmed.length > 10000) {
    throw new OverpassSanitizationError(
      `Query length (${trimmed.length}) exceeds maximum allowable 10,000 characters`,
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
  if (statements.length > 50) {
    throw new OverpassSanitizationError(
      `Query contains ${statements.length} statements, exceeding maximum limit of 50`,
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

  // Extract bounding box if present [bbox:s,w,n,e] or statement (s,w,n,e)
  let detectedBbox: BoundingBox | undefined = options.fallbackBbox;
  const globalBboxMatch = trimmed.match(
    /\[bbox:([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\]/i
  );

  if (globalBboxMatch?.[1] && globalBboxMatch[2] && globalBboxMatch[3] && globalBboxMatch[4]) {
    const s = Number.parseFloat(globalBboxMatch[1]);
    const w = Number.parseFloat(globalBboxMatch[2]);
    const n = Number.parseFloat(globalBboxMatch[3]);
    const e = Number.parseFloat(globalBboxMatch[4]);

    validateCoordinates(s, w, n, e, maxBboxSpanDeg);
    detectedBbox = { min_lat: s, min_lon: w, max_lat: n, max_lon: e };
  } else {
    // Check statement level (s,w,n,e)
    const stmtBboxMatch = trimmed.match(/\(([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\)/);
    if (stmtBboxMatch?.[1] && stmtBboxMatch[2] && stmtBboxMatch[3] && stmtBboxMatch[4]) {
      const s = Number.parseFloat(stmtBboxMatch[1]);
      const w = Number.parseFloat(stmtBboxMatch[2]);
      const n = Number.parseFloat(stmtBboxMatch[3]);
      const e = Number.parseFloat(stmtBboxMatch[4]);

      validateCoordinates(s, w, n, e, maxBboxSpanDeg);
      detectedBbox = { min_lat: s, min_lon: w, max_lat: n, max_lon: e };
    }
  }

  if (!detectedBbox) {
    throw new OverpassSanitizationError(
      'Overpass queries require a bounding box constraint [bbox:s,w,n,e] or statement coordinate filter',
      'UNBOUNDED_QUERY'
    );
  }

  // Normalize query body by removing any existing timeout/out headers
  let cleanBody = trimmed
    .replace(/\[out:[^\]]+\];?/gi, '')
    .replace(/\[timeout:\d+\];?/gi, '')
    .replace(/\[bbox:[^\]]+\];?/gi, '')
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
