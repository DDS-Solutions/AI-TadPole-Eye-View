import {
  type BoundingBox,
  OSM_COMMERCIAL_MAX_BBOX_SPAN_DEG,
  OSM_COMMERCIAL_MAX_TIMEOUT_SEC,
  OSM_COMMERCIAL_WHITELISTED_PRIMARY_KEYS,
  type OsmCommercialCategory,
  type OverpassSanitizationResult,
} from '@gev/contracts';
import { OverpassSanitizationError } from './errors.js';
import { sanitizeOverpassQuery } from './overpassSanitizer.js';

export interface OsmCommercialQueryBuilderOptions {
  bbox: BoundingBox;
  categories?: OsmCommercialCategory[];
  timeoutSec?: number;
  maxBboxSpanDeg?: number;
}

const CATEGORY_TAG_FILTERS: Record<OsmCommercialCategory, string[]> = {
  food_and_beverage: [
    '["amenity"~"^(restaurant|cafe|bar|pub|fast_food|food_court|bistro|ice_cream)$"]',
  ],
  retail: ['["shop"]'],
  services: ['["amenity"~"^(bank|atm|post_office|pharmacy|dry_cleaning|hairdresser|car_wash)$"]'],
  office: ['["office"]', '["commercial"="office"]'],
  craft_industrial: ['["craft"]', '["commercial"="light_industrial"]'],
  healthcare: ['["amenity"~"^(pharmacy|clinic|dentist|hospital|doctors)$"]', '["healthcare"]'],
  hospitality: ['["tourism"~"^(hotel|motel|hostel|guest_house)$"]'],
  other_commercial: ['["commercial"]'],
};

const ALL_CATEGORIES: OsmCommercialCategory[] = [
  'food_and_beverage',
  'retail',
  'services',
  'office',
  'craft_industrial',
  'healthcare',
  'hospitality',
  'other_commercial',
];

/**
 * Validates that an OSM commercial bounding box is geometrically valid and does not
 * exceed maximum allowable geographic span caps.
 */
export function validateOsmCommercialBoundingBox(
  bbox: BoundingBox,
  maxSpanDeg: number = OSM_COMMERCIAL_MAX_BBOX_SPAN_DEG
): void {
  const { min_lat: s, min_lon: w, max_lat: n, max_lon: e } = bbox;

  if (!Number.isFinite(s) || !Number.isFinite(w) || !Number.isFinite(n) || !Number.isFinite(e)) {
    throw new OverpassSanitizationError(
      'Bounding box coordinates must be finite numbers',
      'INVALID_COMMERCIAL_BBOX'
    );
  }

  if (s < -90 || s > 90 || n < -90 || n > 90) {
    throw new OverpassSanitizationError(
      `Latitude out of bounds [-90, 90]: south=${s}, north=${n}`,
      'INVALID_COMMERCIAL_BBOX'
    );
  }

  if (w < -180 || w > 180 || e < -180 || e > 180) {
    throw new OverpassSanitizationError(
      `Longitude out of bounds [-180, 180]: west=${w}, east=${e}`,
      'INVALID_COMMERCIAL_BBOX'
    );
  }

  if (s > n) {
    throw new OverpassSanitizationError(
      `South latitude (${s}) cannot exceed North latitude (${n})`,
      'INVALID_COMMERCIAL_BBOX'
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
      `Commercial bounding box span (${latSpan.toFixed(4)}° lat, ${lonSpan.toFixed(4)}° lon) exceeds maximum allowed ${maxSpanDeg}° cap`,
      'BBOX_AREA_EXCEEDED'
    );
  }
}

/**
 * Builds a deterministic, sanitized Overpass QL query string restricted strictly to
 * whitelisted commercial tags within a validated bounding box.
 */
export function buildSanitizedOsmCommercialOverpassQuery(
  options: OsmCommercialQueryBuilderOptions
): OverpassSanitizationResult {
  const maxSpanDeg = options.maxBboxSpanDeg ?? OSM_COMMERCIAL_MAX_BBOX_SPAN_DEG;
  validateOsmCommercialBoundingBox(options.bbox, maxSpanDeg);

  const timeoutSec = Math.max(
    1,
    Math.min(options.timeoutSec ?? 25, OSM_COMMERCIAL_MAX_TIMEOUT_SEC)
  );
  const categories =
    options.categories && options.categories.length > 0 ? options.categories : ALL_CATEGORIES;

  const { min_lat: s, min_lon: w, max_lat: n, max_lon: e } = options.bbox;
  const statements: string[] = [];

  for (const cat of categories) {
    const filters = CATEGORY_TAG_FILTERS[cat] ?? [];
    for (const filter of filters) {
      statements.push(`  node${filter}(${s},${w},${n},${e});`);
      statements.push(`  way${filter}(${s},${w},${n},${e});`);
    }
  }

  const rawQl = `[out:json][timeout:${timeoutSec}][bbox:${s},${w},${n},${e}];\n(\n${statements.join('\n')}\n);\nout center tags;`;

  return sanitizeOverpassQuery(rawQl, {
    maxTimeoutSec: OSM_COMMERCIAL_MAX_TIMEOUT_SEC,
    defaultTimeoutSec: timeoutSec,
    maxBboxSpanDeg: maxSpanDeg,
    fallbackBbox: options.bbox,
  });
}

/**
 * Asserts that a given Overpass QL query string only targets whitelisted commercial tags
 * and does not execute unwhitelisted arbitrary OpenStreetMap queries.
 */
export function assertOsmCommercialQueryWhitelisted(rawQl: string): void {
  if (!rawQl || typeof rawQl !== 'string') {
    throw new OverpassSanitizationError('Query must be a non-empty string', 'EMPTY_QUERY');
  }

  // Reject administrative, military, boundary, or power grid scraping
  const forbiddenPatterns = [
    /["']boundary["']/i,
    /["']admin_level["']/i,
    /["']military["']/i,
    /["']power["']/i,
    /["']natural["']/i,
    /["']landuse["']/i,
    /["']highway["']/i,
    /["']railway["']/i,
    /["']waterway["']/i,
  ];

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(rawQl)) {
      throw new OverpassSanitizationError(
        `Overpass QL contains unwhitelisted commercial tag or category: ${pattern}`,
        'UNWHITELISTED_COMMERCIAL_QUERY'
      );
    }
  }

  // Ensure at least one whitelisted commercial primary key appears in query filters
  const hasWhitelistedKey = OSM_COMMERCIAL_WHITELISTED_PRIMARY_KEYS.some((key) =>
    new RegExp(`["']${key}["']`).test(rawQl)
  );

  if (!hasWhitelistedKey) {
    throw new OverpassSanitizationError(
      'Overpass QL query does not target any whitelisted commercial primary key (amenity, shop, craft, office, commercial, tourism, healthcare)',
      'UNWHITELISTED_COMMERCIAL_QUERY'
    );
  }
}
