import {
  type EconomicEstimate,
  USGS_3DEP_RETIRED_ENDPOINT_SUBSTRING,
  type Usgs3DepElevationUnit,
} from '@gev/contracts';

// ============================================================================
// Constants & Conversion Factors
// ============================================================================

/**
 * Standard international conversion factor: 1 foot = 0.3048 meters exactly.
 */
export const FEET_TO_METERS_FACTOR = 0.3048 as const;
export const METERS_TO_FEET_FACTOR = 1 / FEET_TO_METERS_FACTOR;

/**
 * Earth mean radius in meters (WGS84 / IUGG).
 */
export const EARTH_RADIUS_METERS = 6371008.8 as const;

// ============================================================================
// Pure Coordinate & Endpoint Validators
// ============================================================================

/**
 * Validates longitude (x) and latitude (y) within standard geographic bounds.
 */
export function validateUsgsCoordinates(x: number, y: number): void {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < -180 || x > 180) {
    throw new Error(`Invalid longitude (x): ${x}. Must be a finite number between -180 and 180.`);
  }
  if (typeof y !== 'number' || !Number.isFinite(y) || y < -90 || y > 90) {
    throw new Error(`Invalid latitude (y): ${y}. Must be a finite number between -90 and 90.`);
  }
}

/**
 * Validates that the EPQS endpoint does not use the retired legacy URL (pqs.php).
 */
export function validateEpqsEndpoint(endpointUrl: string): void {
  const retiredToken = USGS_3DEP_RETIRED_ENDPOINT_SUBSTRING || 'pqs.php';
  if (endpointUrl.includes(retiredToken) || endpointUrl.includes('pqs.php')) {
    throw new Error(
      `USGS 3DEP retired pqs.php endpoint is prohibited. Use modern EPQS REST endpoint https://epqs.nationalmap.gov/v1/json (PLAN.md §10 Task 11.2)`
    );
  }
}

// ============================================================================
// Pure Elevation Unit Conversions
// ============================================================================

/**
 * Converts meters to international feet.
 */
export function metersToFeet(meters: number): number {
  if (!Number.isFinite(meters)) return meters;
  return meters * METERS_TO_FEET_FACTOR;
}

/**
 * Converts international feet to meters.
 */
export function feetToMeters(feet: number): number {
  if (!Number.isFinite(feet)) return feet;
  return feet * FEET_TO_METERS_FACTOR;
}

/**
 * Converts an EconomicEstimate between Meters and Feet while preserving status.
 * Non-coercion law: missing, suppressed, or unavailable estimates are never coerced.
 */
export function convertElevationEstimate(
  estimate: EconomicEstimate,
  targetUnit: Usgs3DepElevationUnit
): EconomicEstimate {
  if (estimate.status !== 'available') {
    return estimate;
  }

  const currentUnit = estimate.unit.toLowerCase();
  const isCurrentlyFeet = currentUnit.includes('foot') || currentUnit.includes('feet');
  const wantsFeet = targetUnit === 'Feet';

  if (isCurrentlyFeet === wantsFeet) {
    return {
      ...estimate,
      unit: targetUnit,
    };
  }

  const convertedValue = wantsFeet ? metersToFeet(estimate.value) : feetToMeters(estimate.value);

  return {
    status: 'available',
    value: convertedValue,
    margin_of_error: null,
    confidence_level: null,
    sample_size: null,
    unit: targetUnit,
    notes: estimate.notes,
  };
}

// ============================================================================
// Non-Coercion Raw EPQS Parser
// ============================================================================

export interface ParsedUsgsElevation {
  elevation: EconomicEstimate;
  elevationMeters: EconomicEstimate;
  elevationFeet: EconomicEstimate;
  isOffCoverage: boolean;
}

/**
 * Parses raw elevation from USGS EPQS response.
 * Non-coercion rule: -1000000 or null sentinel MUST NOT be coerced to 0.0 sea level.
 * Negative land elevations (e.g. Badwater Basin at -86m) are valid and preserved as available.
 */
export function parseUsgsRawElevation(
  rawElevation: number | string | null | undefined,
  rawUnits: string
): ParsedUsgsElevation {
  const normalizedUnits: Usgs3DepElevationUnit =
    rawUnits.toLowerCase().includes('foot') || rawUnits.toLowerCase().includes('feet')
      ? 'Feet'
      : 'Meters';

  if (rawElevation === null || rawElevation === undefined || rawElevation === '') {
    const unavailable: EconomicEstimate = {
      status: 'unavailable',
      reason:
        'USGS 3DEP elevation unavailable: point is outside coverage area or water body (null/empty elevation)',
    };
    return {
      elevation: unavailable,
      elevationMeters: unavailable,
      elevationFeet: unavailable,
      isOffCoverage: true,
    };
  }

  const numericVal =
    typeof rawElevation === 'number' ? rawElevation : Number.parseFloat(String(rawElevation));

  if (!Number.isFinite(numericVal)) {
    const unavailable: EconomicEstimate = {
      status: 'unavailable',
      reason: `USGS 3DEP elevation unavailable: non-numeric response received '${String(rawElevation)}'`,
    };
    return {
      elevation: unavailable,
      elevationMeters: unavailable,
      elevationFeet: unavailable,
      isOffCoverage: true,
    };
  }

  // USGS EPQS sentinel code for off-coverage / oceans: -1000000 or <= -999999
  if (numericVal <= -999999) {
    const unavailable: EconomicEstimate = {
      status: 'unavailable',
      reason:
        'USGS 3DEP elevation unavailable: point is outside coverage area or water body (-1000000 off-coverage)',
    };
    return {
      elevation: unavailable,
      elevationMeters: unavailable,
      elevationFeet: unavailable,
      isOffCoverage: true,
    };
  }

  const elevation: EconomicEstimate = {
    status: 'available',
    value: numericVal,
    margin_of_error: null,
    confidence_level: null,
    sample_size: null,
    unit: normalizedUnits,
  };

  const elevationMeters = convertElevationEstimate(elevation, 'Meters');
  const elevationFeet = convertElevationEstimate(elevation, 'Feet');

  return {
    elevation,
    elevationMeters,
    elevationFeet,
    isOffCoverage: false,
  };
}

// ============================================================================
// Pure Terrain & Slope Calculations
// ============================================================================

/**
 * Calculates great-circle distance between two coordinates in meters (Haversine formula).
 */
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const rLat1 = (lat1 * Math.PI) / 180;
  const rLat2 = (lat2 * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

export interface SlopeCalculationInput {
  x: number;
  y: number;
  elevationMeters: EconomicEstimate;
}

export interface SlopeCalculationResult {
  horizontalDistanceMeters: number;
  elevationChangeMeters: EconomicEstimate;
  slopePercent: EconomicEstimate;
  slopeDegrees: EconomicEstimate;
}

/**
 * Calculates slope gradient between two elevation points.
 * If either point has unavailable elevation, slope metrics evaluate to unavailable.
 */
export function calculateTerrainSlope(
  p1: SlopeCalculationInput,
  p2: SlopeCalculationInput
): SlopeCalculationResult {
  validateUsgsCoordinates(p1.x, p1.y);
  validateUsgsCoordinates(p2.x, p2.y);

  const horizontalDistanceMeters = haversineDistanceMeters(p1.y, p1.x, p2.y, p2.x);

  if (p1.elevationMeters.status !== 'available' || p2.elevationMeters.status !== 'available') {
    const unavailable: EconomicEstimate = {
      status: 'unavailable',
      reason: 'Slope calculation requires available elevation at both endpoints',
    };
    return {
      horizontalDistanceMeters,
      elevationChangeMeters: unavailable,
      slopePercent: unavailable,
      slopeDegrees: unavailable,
    };
  }

  const deltaMeters = p2.elevationMeters.value - p1.elevationMeters.value;
  const elevationChangeMeters: EconomicEstimate = {
    status: 'available',
    value: deltaMeters,
    margin_of_error: null,
    confidence_level: null,
    sample_size: null,
    unit: 'Meters',
  };

  if (horizontalDistanceMeters === 0) {
    const notApplicable: EconomicEstimate = {
      status: 'not_applicable',
      reason: 'Horizontal distance is zero between identical coordinates',
    };
    return {
      horizontalDistanceMeters: 0,
      elevationChangeMeters,
      slopePercent: notApplicable,
      slopeDegrees: notApplicable,
    };
  }

  const absDelta = Math.abs(deltaMeters);
  const slopePercentValue = (absDelta / horizontalDistanceMeters) * 100;
  const slopeDegreesValue = Math.atan(absDelta / horizontalDistanceMeters) * (180 / Math.PI);

  return {
    horizontalDistanceMeters,
    elevationChangeMeters,
    slopePercent: {
      status: 'available',
      value: slopePercentValue,
      margin_of_error: null,
      confidence_level: null,
      sample_size: null,
      unit: 'percent',
    },
    slopeDegrees: {
      status: 'available',
      value: slopeDegreesValue,
      margin_of_error: null,
      confidence_level: null,
      sample_size: null,
      unit: 'degrees',
    },
  };
}
