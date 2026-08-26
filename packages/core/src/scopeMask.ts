import { haversineDistance, initialBearing, normalizeLongitude } from './geoMath.js';

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/**
 * Checks if a target coordinate falls within a specified radius (meters) of a center coordinate.
 */
export function isWithinRadius(
  centerLat: number,
  centerLon: number,
  targetLat: number,
  targetLon: number,
  radiusMeters: number
): boolean {
  const dist = haversineDistance(centerLat, centerLon, targetLat, targetLon);
  return dist <= radiusMeters;
}

/**
 * Checks if a target coordinate falls within an azimuthal field-of-view cone centered on a heading.
 *
 * Edge semantics:
 * - When `inclusiveEdges` is true (default): angles matching exactly `heading ± (fovDeg / 2)` return true.
 * - When `inclusiveEdges` is false: angles matching exactly `heading ± (fovDeg / 2)` return false.
 */
export function isWithinAzimuthCone(
  centerLat: number,
  centerLon: number,
  headingDeg: number,
  fovDeg: number,
  targetLat: number,
  targetLon: number,
  inclusiveEdges = true
): boolean {
  if (fovDeg >= 360) {
    return true;
  }
  if (fovDeg <= 0) {
    return false;
  }

  const bearing = initialBearing(centerLat, centerLon, targetLat, targetLon);
  const normalizedHeading = ((headingDeg % 360) + 360) % 360;

  // Angular difference [-180, 180]
  let diff = Math.abs(bearing - normalizedHeading);
  if (diff > 180) {
    diff = 360 - diff;
  }

  const halfFov = fovDeg / 2;
  return inclusiveEdges ? diff <= halfFov : diff < halfFov;
}

/**
 * Checks if target elevation angle relative to observer is within specified minimum and maximum bounds.
 */
export function isWithinElevationMask(
  slantRangeMeters: number,
  altitudeDeltaMeters: number,
  minElevationDeg: number,
  maxElevationDeg: number
): boolean {
  if (slantRangeMeters <= 0) {
    return false;
  }
  const elevationRad = Math.asin(Math.max(-1, Math.min(1, altitudeDeltaMeters / slantRangeMeters)));
  const elevationDeg = (elevationRad * 180) / Math.PI;

  return elevationDeg >= minElevationDeg && elevationDeg <= maxElevationDeg;
}

/**
 * Standard ray-casting Point-in-Polygon test for geographic coordinates.
 */
export function isPointInPolygon(lat: number, lon: number, polygon: GeoPoint[]): boolean {
  if (polygon.length < 3) {
    return false;
  }

  let inside = false;
  const normalizedLon = normalizeLongitude(lon);

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const ptI = polygon[i];
    const ptJ = polygon[j];
    if (!ptI || !ptJ) {
      continue;
    }

    const xi = normalizeLongitude(ptI.longitude);
    const yi = ptI.latitude;
    const xj = normalizeLongitude(ptJ.longitude);
    const yj = ptJ.latitude;

    const intersect =
      yi > lat !== yj > lat && normalizedLon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;

    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}
