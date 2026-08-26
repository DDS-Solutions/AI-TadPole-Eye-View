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
 */
export function turnRadius(groundSpeedMps: number, bankAngleDeg: number): number {
  const bankRad = (Math.abs(bankAngleDeg) * Math.PI) / 180;
  if (bankRad === 0 || groundSpeedMps <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return (groundSpeedMps * groundSpeedMps) / (GRAVITY_MPS2 * Math.tan(bankRad));
}

/**
 * Calculates rate of turn in degrees per second for a coordinated turn.
 */
export function rateOfTurn(groundSpeedMps: number, bankAngleDeg: number): number {
  if (groundSpeedMps <= 0) {
    return 0;
  }
  const bankRad = (bankAngleDeg * Math.PI) / 180;
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
