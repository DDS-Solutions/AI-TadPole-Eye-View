import {
  SATELLITE_USAGE_NOTICE,
  type SatelliteCatalogResponse,
  SatelliteCatalogResponseSchema,
  type SatelliteOrbitalElement,
  SatelliteOrbitalElementSchema,
  type SatellitePropagatedState,
  SatellitePropagatedStateSchema,
  type SatellitePropagationBatch,
  SatellitePropagationBatchSchema,
} from '@gev/contracts';
import {
  degreesLat,
  degreesLong,
  eciToGeodetic,
  gstime,
  jday,
  json2satrec,
  propagate,
} from 'satellite.js';
import type { OMMJsonObject } from 'satellite.js';
import type { SimClock } from './clock.js';

export const MAX_SATELLITE_PROPAGATION_OFFSET_SECONDS = 7 * 24 * 60 * 60;
const MIN_PROPAGATION_MS = Date.UTC(1957, 0, 1);
const MAX_PROPAGATION_MS = Date.UTC(2100, 0, 1);

export interface SatelliteEciState {
  position_km: { x: number; y: number; z: number };
  velocity_km_s: { x: number; y: number; z: number };
}

export class SatellitePropagationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SatellitePropagationError';
  }
}

function validatedDate(utcMs: number): Date {
  if (!Number.isFinite(utcMs) || utcMs < MIN_PROPAGATION_MS || utcMs > MAX_PROPAGATION_MS) {
    throw new SatellitePropagationError('Propagation time is outside the supported UTC range');
  }
  const date = new Date(utcMs);
  if (!Number.isFinite(date.valueOf())) {
    throw new SatellitePropagationError('Propagation time is not a valid UTC instant');
  }
  return date;
}

export function utcMsToJulianDate(utcMs: number): number {
  return jday(validatedDate(utcMs));
}

function toOmmInput(element: SatelliteOrbitalElement): OMMJsonObject {
  return {
    OBJECT_NAME: element.object_name,
    OBJECT_ID: element.object_id ?? '',
    EPOCH: element.element_epoch,
    MEAN_MOTION: element.mean_motion_rev_per_day,
    ECCENTRICITY: element.eccentricity,
    INCLINATION: element.inclination_deg,
    RA_OF_ASC_NODE: element.right_ascension_deg,
    ARG_OF_PERICENTER: element.argument_of_pericenter_deg,
    MEAN_ANOMALY: element.mean_anomaly_deg,
    EPHEMERIS_TYPE: element.ephemeris_type,
    CLASSIFICATION_TYPE: element.classification_type,
    NORAD_CAT_ID: element.catalog_id,
    ELEMENT_SET_NO: element.element_set_number,
    ...(element.revolution_at_epoch === null ? {} : { REV_AT_EPOCH: element.revolution_at_epoch }),
    BSTAR: element.bstar,
    MEAN_MOTION_DOT: element.mean_motion_dot,
    MEAN_MOTION_DDOT: element.mean_motion_ddot,
  };
}

function assertElementAge(element: SatelliteOrbitalElement, utcMs: number): void {
  // Seed fixtures are explicitly synthetic and have no real-world freshness claim.
  // Exempting them keeps deterministic offline demos usable after the fixture epoch.
  if (element.is_synthetic) {
    return;
  }
  const epochMs = Date.parse(element.element_epoch);
  const offsetSeconds = Math.abs(utcMs - epochMs) / 1_000;
  if (offsetSeconds > MAX_SATELLITE_PROPAGATION_OFFSET_SECONDS) {
    throw new SatellitePropagationError(
      `Satellite '${element.catalog_id}' element epoch is outside the seven-day propagation window`
    );
  }
}

export function propagateSatelliteEci(
  elementInput: SatelliteOrbitalElement,
  utcMs: number
): SatelliteEciState {
  const element = SatelliteOrbitalElementSchema.parse(elementInput);
  const date = validatedDate(utcMs);
  assertElementAge(element, utcMs);

  const satrec = json2satrec(toOmmInput(element));
  const result = propagate(satrec, date, { communityDecayCheckEnabled: true });
  if (!result) {
    throw new SatellitePropagationError(
      `SGP4 failed for satellite '${element.catalog_id}' with error ${satrec.error}`
    );
  }

  return {
    position_km: { ...result.position },
    velocity_km_s: { ...result.velocity },
  };
}

export function propagateSatelliteElement(
  elementInput: SatelliteOrbitalElement,
  utcMs: number
): SatellitePropagatedState {
  const element = SatelliteOrbitalElementSchema.parse(elementInput);
  const date = validatedDate(utcMs);
  const eci = propagateSatelliteEci(element, utcMs);
  const geodetic = eciToGeodetic(eci.position_km, gstime(date));
  const speedKmS = Math.hypot(eci.velocity_km_s.x, eci.velocity_km_s.y, eci.velocity_km_s.z);

  if (geodetic.height < 0 || !Number.isFinite(speedKmS)) {
    throw new SatellitePropagationError(
      `SGP4 produced an invalid state for satellite '${element.catalog_id}'`
    );
  }

  return SatellitePropagatedStateSchema.parse({
    catalog_id: element.catalog_id,
    object_name: element.object_name,
    object_id: element.object_id,
    source_group: element.source_group,
    element_epoch: element.element_epoch,
    propagated_at: date.toISOString(),
    propagation_method: 'sgp4',
    is_estimate: true,
    longitude_deg: degreesLong(geodetic.longitude),
    latitude_deg: degreesLat(geodetic.latitude),
    altitude_m: geodetic.height * 1_000,
    speed_mps: speedKmS * 1_000,
  });
}

export function propagateSatelliteCatalog(
  catalogInput: SatelliteCatalogResponse,
  utcMs: number
): SatellitePropagationBatch {
  const catalog = SatelliteCatalogResponseSchema.parse(catalogInput);
  const propagatedAt = validatedDate(utcMs).toISOString();
  const states = catalog.elements.map((element) => propagateSatelliteElement(element, utcMs));

  return SatellitePropagationBatchSchema.parse({
    schema_version: 1,
    catalog_id: catalog.catalog_id,
    groups: catalog.groups,
    propagated_at: propagatedAt,
    coordinate_frame: 'wgs84-geodetic',
    propagation_method: 'sgp4',
    is_estimate: true,
    usage_notice: SATELLITE_USAGE_NOTICE,
    states,
    provenance: catalog.provenance,
  });
}

export class SatellitePropagator {
  constructor(private readonly clock: SimClock) {}

  propagate(catalog: SatelliteCatalogResponse): SatellitePropagationBatch {
    return propagateSatelliteCatalog(catalog, this.clock.now());
  }
}
