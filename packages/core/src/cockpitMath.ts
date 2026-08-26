/**
 * Aviation and cockpit domain calculations.
 * Pure mathematical functions, zero I/O.
 */

export const GRAVITY_MPS2 = 9.80665;
export const FPM_TO_MPS = 0.00508;
export const KNOTS_TO_MPS = 0.5144444444444445;

export function fpmToMps(fpm: number): number {
  return fpm * FPM_TO_MPS;
}

export function mpsToFpm(mps: number): number {
  return mps / FPM_TO_MPS;
}

export function knotsToMps(knots: number): number {
  return knots * KNOTS_TO_MPS;
}

export function mpsToKnots(mps: number): number {
  return mps / KNOTS_TO_MPS;
}

/**
 * Calculates glide slope descent angle in degrees given vertical descent rate and ground speed.
 *
 * @param verticalRateMps - Vertical descent rate in meters per second (magnitude or signed).
 * @param groundSpeedMps - Horizontal ground speed in meters per second.
 * @returns Glide slope angle in degrees [0, 90]. Returns 0 as a sentinel value if groundSpeedMps <= 0 (e.g. stationary or hovering aircraft).
 */
export function glideSlopeAngle(verticalRateMps: number, groundSpeedMps: number): number {
  if (groundSpeedMps <= 0) {
    return 0;
  }
  const ratio = Math.abs(verticalRateMps) / groundSpeedMps;
  return (Math.atan(ratio) * 180) / Math.PI;
}

/**
 * Calculates turn radius in meters for a coordinated turn.
 * Turn radius is always returned as a non-negative scalar magnitude.
 *
 * @param groundSpeedMps - True airspeed / ground speed in meters per second.
 * @param bankAngleDeg - Aircraft bank angle in degrees. Bank domain is guarded to [0, 90) degrees.
 * @returns Turn radius in meters. Returns Infinity if bankAngle is 0, >= 90 deg, or groundSpeed <= 0.
 */
export function turnRadius(groundSpeedMps: number, bankAngleDeg: number): number {
  const absBank = Math.abs(bankAngleDeg);
  if (absBank >= 90 || absBank === 0 || groundSpeedMps <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const bankRad = (absBank * Math.PI) / 180;
  return (groundSpeedMps * groundSpeedMps) / (GRAVITY_MPS2 * Math.tan(bankRad));
}

/**
 * Calculates rate of turn in degrees per second for a coordinated turn.
 * Preserves turn direction sign (positive = right turn / bank > 0, negative = left turn / bank < 0).
 *
 * @param groundSpeedMps - True airspeed / ground speed in meters per second.
 * @param bankAngleDeg - Aircraft bank angle in degrees (-90, 90). Clamped to (-90, 90) to prevent tan(90) divergence.
 * @returns Rate of turn in degrees per second. Returns 0 if groundSpeed <= 0.
 */
export function rateOfTurn(groundSpeedMps: number, bankAngleDeg: number): number {
  if (groundSpeedMps <= 0) {
    return 0;
  }
  // Guard against bank angle >= 90 deg causing tan divergence or sign flip
  const clampedBank = Math.max(-89.999, Math.min(89.999, bankAngleDeg));
  const bankRad = (clampedBank * Math.PI) / 180;
  const radPerSec = (GRAVITY_MPS2 * Math.tan(bankRad)) / groundSpeedMps;
  return (radPerSec * 180) / Math.PI;
}

/**
 * Computes speed of sound in m/s at a given altitude using International Standard Atmosphere (ISA).
 */
export function speedOfSound(altitudeMeters: number): number {
  const clampedAlt = Math.max(0, altitudeMeters);
  const T0 = 288.15; // Sea level standard temperature (K)
  const lapseRate = 0.0065; // K/m in troposphere up to 11km
  const tropopauseAlt = 11000;

  let temperatureK: number;
  if (clampedAlt <= tropopauseAlt) {
    temperatureK = T0 - lapseRate * clampedAlt;
  } else {
    temperatureK = T0 - lapseRate * tropopauseAlt; // Isothermal stratosphere ~216.65K
  }

  const gamma = 1.4; // Heat capacity ratio for air
  const R = 287.05287; // Specific gas constant for dry air (J/(kg·K))
  return Math.sqrt(gamma * R * temperatureK);
}

/**
 * Computes Mach number from True Airspeed (m/s) and altitude (meters).
 */
export function machNumber(trueAirspeedMps: number, altitudeMeters: number): number {
  const soundSpeed = speedOfSound(altitudeMeters);
  if (soundSpeed <= 0) {
    return 0;
  }
  return trueAirspeedMps / soundSpeed;
}
