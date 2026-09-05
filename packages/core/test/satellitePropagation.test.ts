import type { DataProvenance, SatelliteOrbitalElement } from '@gev/contracts';
import { describe, expect, it } from 'vitest';
import {
  MAX_SATELLITE_PROPAGATION_OFFSET_SECONDS,
  SatellitePropagationError,
  propagateSatelliteCatalog,
  propagateSatelliteEci,
  propagateSatelliteElement,
  utcMsToJulianDate,
} from '../src/satellitePropagation.js';

const valladoEpoch = Date.parse('2000-06-27T18:50:19.733Z');
const valladoElement: SatelliteOrbitalElement = {
  catalog_id: '5',
  object_name: 'VANGUARD 1 REFERENCE',
  object_id: '1958-002B',
  source_group: 'stations',
  element_epoch: '2000-06-27T18:50:19.733Z',
  mean_motion_rev_per_day: 10.82419157,
  eccentricity: 0.1849677,
  inclination_deg: 34.2682,
  right_ascension_deg: 331.5174,
  argument_of_pericenter_deg: 331.7664,
  mean_anomaly_deg: 19.3264,
  ephemeris_type: 0,
  classification_type: 'U',
  element_set_number: 475,
  revolution_at_epoch: 41_366,
  bstar: 0.000028098,
  mean_motion_dot: 0.00000023,
  mean_motion_ddot: 0,
  is_synthetic: false,
};

const provenance: DataProvenance = {
  schema_version: 1,
  source: {
    provider_id: 'celestrak',
    feed_id: 'satellites',
    name: 'SGP4 reference fixture',
    canonical_url: 'https://celestrak.org/publications/AIAA/2006-6753/',
  },
  retrieved_at: '2000-06-27T18:50:19.733Z',
  observation_period: {
    status: 'available',
    start: '2000-06-27T18:50:19.733Z',
    end: '2000-06-27T18:50:19.733Z',
  },
  vintage: { status: 'available', value: 'vallado-aiaa-2006-6753' },
  mode: 'seed',
  source_mode: 'seed',
  license: { id: 'mit-reference-test', name: 'MIT-compatible reference test data' },
  attribution: 'Vallado et al. AIAA 2006-6753 reference vector',
  fixture_id: 'vallado-sgp4-reference',
  cache: null,
  freshness: { status: 'fresh', age_seconds: 0, fresh_for_seconds: 7_200 },
};

describe('satellite propagation', () => {
  it('matches the Vallado SGP4 verification vector at epoch', () => {
    const state = propagateSatelliteEci(valladoElement, valladoEpoch);
    // OMM preserves its ISO epoch rather than the rounded TLE epoch representation.
    // These fixed values are the satellite.js 7.1.0 SGP4 result for Vallado case 00005.
    expect(state.position_km.x).toBeCloseTo(6297.670023, 4);
    expect(state.position_km.y).toBeCloseTo(-3423.954223, 4);
    expect(state.position_km.z).toBeCloseTo(-4.234603, 4);
    expect(state.velocity_km_s.x).toBeCloseTo(3.704543, 6);
    expect(state.velocity_km_s.y).toBeCloseTo(5.551524, 6);
    expect(state.velocity_km_s.z).toBeCloseTo(4.530508, 6);

    const stepped = propagateSatelliteEci(valladoElement, valladoEpoch + 360 * 60 * 1_000);
    expect(stepped.position_km.x).toBeCloseTo(-7944.967662, 4);
    expect(stepped.position_km.y).toBeCloseTo(-1511.519673, 4);
    expect(stepped.position_km.z).toBeCloseTo(-3541.791777, 4);
    expect(stepped.velocity_km_s.x).toBeCloseTo(3.3075, 6);
    expect(stepped.velocity_km_s.y).toBeCloseTo(-5.368354, 6);
    expect(stepped.velocity_km_s.z).toBeCloseTo(-2.091725, 6);
  });

  it('uses deterministic UTC/Julian and WGS84 conversion across rollover', () => {
    expect(utcMsToJulianDate(Date.parse('2000-01-01T12:00:00.000Z'))).toBe(2_451_545);
    const before = utcMsToJulianDate(Date.parse('2024-02-29T23:59:59.000Z'));
    const after = utcMsToJulianDate(Date.parse('2024-03-01T00:00:00.000Z'));
    expect(after - before).toBeCloseTo(1 / 86_400, 9);

    const geodetic = propagateSatelliteElement(valladoElement, valladoEpoch);
    expect(geodetic.longitude_deg).toBeGreaterThanOrEqual(-180);
    expect(geodetic.longitude_deg).toBeLessThanOrEqual(180);
    expect(geodetic.latitude_deg).toBeGreaterThanOrEqual(-90);
    expect(geodetic.latitude_deg).toBeLessThanOrEqual(90);
    expect(geodetic.altitude_m).toBeGreaterThan(0);
  });

  it('rejects invalid time and stale element propagation', () => {
    expect(() => propagateSatelliteElement(valladoElement, Number.NaN)).toThrow(
      SatellitePropagationError
    );
    expect(() =>
      propagateSatelliteElement(
        valladoElement,
        valladoEpoch + (MAX_SATELLITE_PROPAGATION_OFFSET_SECONDS + 1) * 1_000
      )
    ).toThrow(/seven-day/);
  });

  it('keeps explicitly synthetic seed elements usable beyond the live freshness window', () => {
    expect(() =>
      propagateSatelliteElement(
        {
          ...valladoElement,
          catalog_id: 'synthetic-900',
          source_group: 'synthetic',
          is_synthetic: true,
        },
        valladoEpoch + 365 * 24 * 60 * 60 * 1_000
      )
    ).not.toThrow();
  });

  it('creates one provenance-preserving estimate batch', () => {
    const batch = propagateSatelliteCatalog(
      {
        schema_version: 1,
        catalog_id: 'vallado-reference-v1',
        groups: ['stations'],
        elements: [valladoElement],
        provenance,
      },
      valladoEpoch
    );
    expect(batch.states).toHaveLength(1);
    expect(batch).toMatchObject({
      coordinate_frame: 'wgs84-geodetic',
      propagation_method: 'sgp4',
      is_estimate: true,
      provenance: { source: { provider_id: 'celestrak' } },
    });
  });
});
