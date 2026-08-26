/**
 * Pure geospatial mathematics (WGS84 spherical approximations).
 * Zero I/O, deterministic, property-testable.
 */

export const EARTH_RADIUS_METERS = 6371008.8;

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Normalizes longitude to [-180, 180) degrees.
 */
export function normalizeLongitude(lon: number): number {
  let normalized = (lon + 180) % 360;
  if (normalized < 0) {
    normalized += 360;
  }
  return normalized - 180;
}

/**
 * Clamps latitude to [-90, 90] degrees.
 */
export function normalizeLatitude(lat: number): number {
  return Math.max(-90, Math.min(90, lat));
}

/**
 * Calculates Great Circle distance between two points using the Haversine formula.
 * Returns distance in meters.
 */
export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaPhi = toRad(lat2 - lat1);
  const deltaLambda = toRad(normalizeLongitude(lon2 - lon1));

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);

  const c = 2 * Math.atan2(Math.sqrt(Math.min(1, a)), Math.sqrt(Math.max(0, 1 - a)));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Calculates initial bearing (azimuth) from point 1 to point 2.
 * Returns bearing in decimal degrees [0, 360).
 */
export function initialBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaLambda = toRad(normalizeLongitude(lon2 - lon1));

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  const theta = Math.atan2(y, x);
  return (toDeg(theta) + 360) % 360;
}

/**
 * Calculates final bearing arriving at point 2 from point 1.
 * Returns bearing in decimal degrees [0, 360).
 */
export function finalBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  // Final bearing is initial bearing in reverse direction from 2 to 1 + 180°
  return (initialBearing(lat2, lon2, lat1, lon1) + 180) % 360;
}

/**
 * Computes destination point given start coordinate, distance (meters), and bearing (degrees).
 */
export function destinationPoint(
  lat: number,
  lon: number,
  distanceMeters: number,
  bearingDeg: number
): { latitude: number; longitude: number } {
  const delta = distanceMeters / EARTH_RADIUS_METERS;
  const theta = toRad(bearingDeg);
  const phi1 = toRad(lat);
  const lambda1 = toRad(lon);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const sinDelta = Math.sin(delta);
  const cosDelta = Math.cos(delta);

  const sinPhi2 = sinPhi1 * cosDelta + cosPhi1 * sinDelta * Math.cos(theta);
  const phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi2)));

  const y = Math.sin(theta) * sinDelta * cosPhi1;
  const x = cosDelta - sinPhi1 * Math.sin(phi2);
  const lambda2 = lambda1 + Math.atan2(y, x);

  return {
    latitude: normalizeLatitude(toDeg(phi2)),
    longitude: normalizeLongitude(toDeg(lambda2)),
  };
}

/**
 * Calculates intermediate midpoint coordinate along great circle path.
 */
export function midpoint(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): { latitude: number; longitude: number } {
  const phi1 = toRad(lat1);
  const lambda1 = toRad(lon1);
  const phi2 = toRad(lat2);
  const deltaLambda = toRad(normalizeLongitude(lon2 - lon1));

  const Bx = Math.cos(phi2) * Math.cos(deltaLambda);
  const By = Math.cos(phi2) * Math.sin(deltaLambda);

  const phi3 = Math.atan2(
    Math.sin(phi1) + Math.sin(phi2),
    Math.sqrt((Math.cos(phi1) + Bx) * (Math.cos(phi1) + Bx) + By * By)
  );
  const lambda3 = lambda1 + Math.atan2(By, Math.cos(phi1) + Bx);

  return {
    latitude: normalizeLatitude(toDeg(phi3)),
    longitude: normalizeLongitude(toDeg(lambda3)),
  };
}
