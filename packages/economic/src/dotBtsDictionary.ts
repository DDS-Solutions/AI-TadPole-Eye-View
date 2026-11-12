import {
  DOT_BTS_BASE_URL,
  DOT_BTS_DATA_HORIZON,
  DOT_BTS_DEFAULT_VINTAGE,
  DOT_BTS_SCHEMA_VERSION,
  DOT_BTS_SCREENING_DISCLAIMER,
  type DotBtsAccessibilityRecord,
  type DotBtsAccessibilityTier,
  type DotBtsFreightCorridorExposure,
  type EconomicEstimate,
  type EconomicGeography,
} from '@gev/contracts';
import { haversineDistanceMeters } from './usgs3depConversions.js';

export {
  DOT_BTS_SCHEMA_VERSION,
  DOT_BTS_DEFAULT_VINTAGE,
  DOT_BTS_BASE_URL,
  DOT_BTS_DATA_HORIZON,
  DOT_BTS_SCREENING_DISCLAIMER,
};

// ============================================================================
// Pure Geography & Endpoint Validators
// ============================================================================

const ALLOWED_DOT_BTS_GEOGRAPHIES = [
  'nation',
  'state',
  'county',
  'cbsa',
  'place',
  'tract',
  'point',
  'bounding_box',
] as const;

export function validateDotBtsGeography(geography: EconomicGeography): void {
  if (!(ALLOWED_DOT_BTS_GEOGRAPHIES as readonly string[]).includes(geography.level)) {
    throw new Error(
      `DOT/BTS accessibility supports geographies: ${ALLOWED_DOT_BTS_GEOGRAPHIES.join(', ')}. Received unsupported level '${geography.level}'`
    );
  }
}

export function validateDotBtsEndpoint(endpointUrl: string): void {
  const parsed = new URL(endpointUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error(`DOT/BTS endpoint must use HTTPS, received '${parsed.protocol}'`);
  }
}

// ============================================================================
// Non-Coercion Measurement Parser & Deterministic Classifiers
// ============================================================================

/**
 * Parses a raw DOT/BTS transportation metric into an EconomicEstimate.
 * Non-coercion law:
 * - Uncovered geographies, null/empty/NaN, or negative distances MUST evaluate
 *   to `{ status: 'unavailable' }` and NEVER coerce to `0.0`.
 * - Legitimate `0.0` (e.g. site directly adjacent to a transit stop) with
 *   `isCovered === true` remains `{ status: 'available', value: 0 }`.
 */
export function parseDotBtsMeasurement(
  rawValue: number | string | null | undefined,
  unit: string,
  isCovered: boolean,
  notes?: string
): EconomicEstimate {
  if (!isCovered) {
    return {
      status: 'unavailable',
      reason: 'Geography is outside DOT/BTS accessibility fixture or service coverage',
    };
  }

  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return {
      status: 'unavailable',
      reason: 'DOT/BTS transportation metric is missing or unreported',
    };
  }

  const numericVal = typeof rawValue === 'number' ? rawValue : Number.parseFloat(String(rawValue));
  if (!Number.isFinite(numericVal) || numericVal < 0) {
    return {
      status: 'unavailable',
      reason: `DOT/BTS transportation metric is invalid or negative (${String(rawValue)})`,
    };
  }

  return {
    status: 'available',
    value: numericVal,
    margin_of_error: null,
    confidence_level: null,
    sample_size: null,
    unit,
    ...(notes ? { notes } : {}),
  };
}

/**
 * Classifies multimodal accessibility tier strictly from available metrics.
 * Never coerces missing metrics into 'auto_dependent' or 'high_access'.
 */
export function classifyDotBtsAccessibilityTier(
  nearestTransitStopKm: EconomicEstimate,
  transitStopsWithin1km: EconomicEstimate,
  walkableRoadDensity: EconomicEstimate
): DotBtsAccessibilityTier {
  if (nearestTransitStopKm.status !== 'available' && walkableRoadDensity.status !== 'available') {
    return 'unavailable';
  }

  const transitKm =
    nearestTransitStopKm.status === 'available'
      ? nearestTransitStopKm.value
      : Number.POSITIVE_INFINITY;
  const stops1km = transitStopsWithin1km.status === 'available' ? transitStopsWithin1km.value : 0;
  const roadDensity = walkableRoadDensity.status === 'available' ? walkableRoadDensity.value : 0;

  if (transitKm <= 0.8 && (stops1km >= 6 || roadDensity >= 10)) {
    return 'high_access';
  }
  if (transitKm <= 2.5 || stops1km >= 2 || roadDensity >= 6) {
    return 'moderate_access';
  }
  if (Number.isFinite(transitKm) && transitKm <= 10) {
    return 'limited_access';
  }
  return 'auto_dependent';
}

/**
 * Classifies freight corridor exposure without zero-coercion of unavailable distances.
 */
export function classifyDotBtsFreightExposure(
  freightCorridorDistanceKm: EconomicEstimate
): DotBtsFreightCorridorExposure {
  if (freightCorridorDistanceKm.status !== 'available') {
    return 'unavailable';
  }
  const distKm = freightCorridorDistanceKm.value;
  if (distKm <= 0.5) return 'primary_freight_corridor';
  if (distKm <= 3.0) return 'secondary_arterial';
  return 'local_access';
}

export function matchesDotBtsGeography(
  record: DotBtsAccessibilityRecord,
  geography: EconomicGeography,
  radiusKm = 25
): boolean {
  const g = record.geography;
  if (g.level === geography.level) {
    switch (geography.level) {
      case 'nation':
        return g.level === 'nation' && g.country_code === geography.country_code;
      case 'state':
        return g.level === 'state' && g.state_fips === geography.state_fips;
      case 'county':
        return g.level === 'county' && g.county_fips === geography.county_fips;
      case 'cbsa':
        return g.level === 'cbsa' && g.cbsa_code === geography.cbsa_code;
      case 'place':
        return g.level === 'place' && g.place_fips === geography.place_fips;
      case 'tract':
        return g.level === 'tract' && g.tract_fips === geography.tract_fips;
    }
  }

  if (geography.level === 'state' && g.level === 'county') {
    return g.county_fips.slice(0, 2) === geography.state_fips;
  }

  if (geography.level === 'point' && record.centroid) {
    const distanceMeters = haversineDistanceMeters(
      geography.latitude,
      geography.longitude,
      record.centroid.latitude,
      record.centroid.longitude
    );
    return distanceMeters <= radiusKm * 1000;
  }

  if (geography.level === 'bounding_box' && record.centroid) {
    return (
      record.centroid.latitude >= geography.min_lat &&
      record.centroid.latitude <= geography.max_lat &&
      record.centroid.longitude >= geography.min_lon &&
      record.centroid.longitude <= geography.max_lon
    );
  }

  return false;
}
