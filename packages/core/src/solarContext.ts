import {
  type SolarBoundary,
  type SolarContextPayload,
  SolarContextPayloadSchema,
  type SolarLightBand,
} from '@gev/contracts';
import type { SimClock } from './clock.js';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const JULIAN_UNIX_EPOCH = 2_440_587.5;
const JULIAN_J2000 = 2_451_545;

function normalizeDegrees(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function solarCoordinates(atMs: number): { longitude: number; latitude: number } {
  if (!Number.isFinite(atMs)) throw new Error('Solar context requires a finite SimClock instant');
  const julianDay = atMs / 86_400_000 + JULIAN_UNIX_EPOCH;
  const daysSinceJ2000 = julianDay - JULIAN_J2000;
  const meanLongitude = normalizeDegrees(280.46 + 0.985_647_4 * daysSinceJ2000);
  const meanAnomaly = normalizeDegrees(357.528 + 0.985_600_3 * daysSinceJ2000) * DEG_TO_RAD;
  const eclipticLongitude =
    (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * DEG_TO_RAD;
  const obliquity = (23.439 - 0.000_000_4 * daysSinceJ2000) * DEG_TO_RAD;
  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLongitude),
    Math.cos(eclipticLongitude)
  );
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const centuries = daysSinceJ2000 / 36_525;
  const greenwichSiderealDegrees =
    280.460_618_37 +
    360.985_647_366_29 * daysSinceJ2000 +
    0.000_387_933 * centuries ** 2 -
    centuries ** 3 / 38_710_000;

  return {
    longitude: normalizeDegrees(rightAscension * RAD_TO_DEG - greenwichSiderealDegrees),
    latitude: declination * RAD_TO_DEG,
  };
}

function boundaryForAltitude(
  subsolar: { longitude: number; latitude: number },
  band: SolarBoundary['band'],
  altitudeDeg: SolarBoundary['solar_altitude_deg'],
  sampleCount: number
): SolarBoundary {
  const solarLatitude = subsolar.latitude * DEG_TO_RAD;
  const solarLongitude = subsolar.longitude * DEG_TO_RAD;
  const solarVector = {
    x: Math.cos(solarLatitude) * Math.cos(solarLongitude),
    y: Math.cos(solarLatitude) * Math.sin(solarLongitude),
    z: Math.sin(solarLatitude),
  };
  const basisU = { x: -Math.sin(solarLongitude), y: Math.cos(solarLongitude), z: 0 };
  const basisV = {
    x: -Math.sin(solarLatitude) * Math.cos(solarLongitude),
    y: -Math.sin(solarLatitude) * Math.sin(solarLongitude),
    z: Math.cos(solarLatitude),
  };
  const angularDistance = (90 - altitudeDeg) * DEG_TO_RAD;
  const radial = Math.sin(angularDistance);
  const axial = Math.cos(angularDistance);
  const coordinates: SolarBoundary['coordinates'] = [];

  for (let index = 0; index <= sampleCount; index += 1) {
    const angle = (index / sampleCount) * Math.PI * 2;
    const tangentU = Math.cos(angle) * radial;
    const tangentV = Math.sin(angle) * radial;
    const x = axial * solarVector.x + tangentU * basisU.x + tangentV * basisV.x;
    const y = axial * solarVector.y + tangentU * basisU.y + tangentV * basisV.y;
    const z = axial * solarVector.z + tangentU * basisU.z + tangentV * basisV.z;
    coordinates.push({
      longitude: normalizeDegrees(Math.atan2(y, x) * RAD_TO_DEG),
      latitude: Math.asin(Math.max(-1, Math.min(1, z))) * RAD_TO_DEG,
    });
  }

  coordinates[coordinates.length - 1] = coordinates[0] as (typeof coordinates)[number];

  return { band, solar_altitude_deg: altitudeDeg, coordinates };
}

export function solarElevationDegrees(
  subsolar: { longitude: number; latitude: number },
  point: { longitude: number; latitude: number }
): number {
  const solarLatitude = subsolar.latitude * DEG_TO_RAD;
  const pointLatitude = point.latitude * DEG_TO_RAD;
  const longitudeDifference = (point.longitude - subsolar.longitude) * DEG_TO_RAD;
  const dot =
    Math.sin(solarLatitude) * Math.sin(pointLatitude) +
    Math.cos(solarLatitude) * Math.cos(pointLatitude) * Math.cos(longitudeDifference);
  return Math.asin(Math.max(-1, Math.min(1, dot))) * RAD_TO_DEG;
}

export function classifySolarLight(elevationDeg: number): SolarLightBand {
  if (elevationDeg >= 0) return 'day';
  if (elevationDeg >= -6) return 'civil_twilight';
  if (elevationDeg >= -12) return 'nautical_twilight';
  if (elevationDeg >= -18) return 'astronomical_twilight';
  return 'night';
}

export function calculateSolarContextAt(atMs: number, sampleCount = 180): SolarContextPayload {
  if (!Number.isInteger(sampleCount) || sampleCount < 72 || sampleCount > 720) {
    throw new Error('Solar boundary sample count must be an integer from 72 through 720');
  }
  const subsolarPoint = solarCoordinates(atMs);
  return SolarContextPayloadSchema.parse({
    computed_at: new Date(atMs).toISOString(),
    subsolar_point: subsolarPoint,
    boundaries: [
      boundaryForAltitude(subsolarPoint, 'sunset', 0, sampleCount),
      boundaryForAltitude(subsolarPoint, 'civil', -6, sampleCount),
      boundaryForAltitude(subsolarPoint, 'nautical', -12, sampleCount),
      boundaryForAltitude(subsolarPoint, 'astronomical', -18, sampleCount),
    ],
    north_pole: classifySolarLight(
      solarElevationDegrees(subsolarPoint, { longitude: 0, latitude: 90 })
    ),
    south_pole: classifySolarLight(
      solarElevationDegrees(subsolarPoint, { longitude: 0, latitude: -90 })
    ),
  });
}

export function calculateSolarContext(clock: SimClock, sampleCount = 180): SolarContextPayload {
  return calculateSolarContextAt(clock.now(), sampleCount);
}
