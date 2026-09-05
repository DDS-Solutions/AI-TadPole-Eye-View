import { describe, expect, it } from 'vitest';
import {
  MAX_SATELLITE_RECORDS,
  SatelliteCatalogSchema,
  SatelliteOrbitalElementSchema,
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
});
