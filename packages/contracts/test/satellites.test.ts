import { describe, expect, it } from 'vitest';
import {
  MAX_SATELLITE_RECORDS,
  SATELLITE_USAGE_NOTICE,
  SatelliteCatalogSchema,
  SatelliteOrbitalElementSchema,
  SatellitePropagationBatchSchema,
} from '../src/index.js';

const validElement = {
  catalog_id: 'synthetic-001',
  object_name: 'GEV SYNTHETIC LEO 1',
  object_id: null,
  source_group: 'synthetic',
  element_epoch: '2026-09-04T12:00:00.000Z',
  mean_motion_rev_per_day: 15.25,
  eccentricity: 0.001,
  inclination_deg: 51.6,
  right_ascension_deg: 20,
  argument_of_pericenter_deg: 40,
  mean_anomaly_deg: 10,
  ephemeris_type: 0,
  classification_type: 'U',
  element_set_number: 1,
  revolution_at_epoch: 10,
  bstar: 0.00001,
  mean_motion_dot: 0,
  mean_motion_ddot: 0,
  is_synthetic: true,
} as const;

const validProvenance = {
  schema_version: 1,
  source: {
    provider_id: 'celestrak',
    feed_id: 'satellites',
    name: 'GEV synthetic satellite fixture',
    canonical_url: 'fixture://satellites-synthetic-v1',
  },
  retrieved_at: '2026-09-04T12:30:00.000Z',
  observation_period: {
    status: 'available',
    start: '2026-09-04T12:00:00.000Z',
    end: '2026-09-04T12:00:00.000Z',
  },
  vintage: { status: 'available', value: 'synthetic-fixture-2026-09-04' },
  mode: 'seed',
  source_mode: 'seed',
  license: { id: 'gev-synthetic-fixture-mit', name: 'GEV synthetic fixture (MIT)' },
  attribution: 'GEV-authored synthetic orbital elements',
  fixture_id: 'satellites-synthetic-v1',
  cache: null,
  freshness: { status: 'fresh', age_seconds: 0, fresh_for_seconds: 7_200 },
} as const;

function validPropagationBatch() {
  return {
    schema_version: 1,
    catalog_id: 'satellites-synthetic-v1',
    groups: ['synthetic'],
    propagated_at: '2026-09-04T12:30:00.000Z',
    coordinate_frame: 'wgs84-geodetic',
    propagation_method: 'sgp4',
    is_estimate: true,
    usage_notice: SATELLITE_USAGE_NOTICE,
    input_count: 1,
    omitted_count: 0,
    states: [
      {
        catalog_id: 'synthetic-001',
        object_name: 'GEV SYNTHETIC LEO 1',
        object_id: null,
        source_group: 'synthetic',
        element_epoch: '2026-09-04T12:00:00.000Z',
        propagated_at: '2026-09-04T12:30:00.000Z',
        propagation_method: 'sgp4',
        is_estimate: true,
        longitude_deg: -75,
        latitude_deg: 40,
        altitude_m: 420_000,
        speed_mps: 7_650,
      },
    ],
    provenance: validProvenance,
  } as const;
}

describe('satellite contracts', () => {
  it('accepts a bounded synthetic GP/OMM catalog', () => {
    const catalog = SatelliteCatalogSchema.parse({
      schema_version: 1,
      catalog_id: 'satellites-synthetic-v1',
      groups: ['synthetic'],
      elements: [validElement],
    });
    expect(catalog.elements[0]?.catalog_id).toBe('synthetic-001');
  });

  it('accepts numeric catalog IDs up to nine digits without a TLE contract', () => {
    expect(
      SatelliteOrbitalElementSchema.parse({
        ...validElement,
        catalog_id: '123456789',
        source_group: 'stations',
        is_synthetic: false,
      }).catalog_id
    ).toBe('123456789');
  });

  it('rejects mixed synthetic identity and malformed orbital bounds', () => {
    expect(() =>
      SatelliteOrbitalElementSchema.parse({
        ...validElement,
        source_group: 'stations',
        eccentricity: 1,
        inclination_deg: 181,
      })
    ).toThrow();
  });

  it('rejects duplicates, undeclared groups, and oversized catalogs', () => {
    expect(() =>
      SatelliteCatalogSchema.parse({
        schema_version: 1,
        catalog_id: 'satellites-synthetic-v1',
        groups: ['synthetic'],
        elements: [validElement, validElement],
      })
    ).toThrow(/duplicate/);

    const oversized = Array.from({ length: MAX_SATELLITE_RECORDS + 1 }, (_, index) => ({
      ...validElement,
      catalog_id: `synthetic-${String(index).padStart(3, '0')}`,
    }));
    expect(() =>
      SatelliteCatalogSchema.parse({
        schema_version: 1,
        catalog_id: 'satellites-synthetic-v1',
        groups: ['synthetic'],
        elements: oversized,
      })
    ).toThrow();
  });

  it('requires propagation groups and accounting to match the emitted states', () => {
    expect(SatellitePropagationBatchSchema.parse(validPropagationBatch()).states).toHaveLength(1);

    expect(() =>
      SatellitePropagationBatchSchema.parse({
        ...validPropagationBatch(),
        groups: ['synthetic', 'synthetic'],
      })
    ).toThrow(/unique/);

    expect(() =>
      SatellitePropagationBatchSchema.parse({
        ...validPropagationBatch(),
        groups: ['stations'],
      })
    ).toThrow(/absent from batch groups/);

    expect(() =>
      SatellitePropagationBatchSchema.parse({
        ...validPropagationBatch(),
        groups: ['stations'],
        states: [
          {
            ...validPropagationBatch().states[0],
            source_group: 'stations',
          },
        ],
      })
    ).toThrow(/synthetic identity and group/);

    expect(() =>
      SatellitePropagationBatchSchema.parse({
        ...validPropagationBatch(),
        input_count: 2,
      })
    ).toThrow(/counts must equal/);
  });
});
