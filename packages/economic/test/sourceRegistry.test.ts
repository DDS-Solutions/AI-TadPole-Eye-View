import { describe, expect, it } from 'vitest';
import {
  ECONOMIC_SOURCE_REGISTRY,
  type EconomicSourceId,
  getEconomicSource,
  isEconomicSourceRegistered,
  listEconomicSources,
} from '../src/sourceRegistry.js';

describe('Economic Source Registry (ADR 0052)', () => {
  it('registers all 9 core economic data sources', () => {
    const expectedSources: EconomicSourceId[] = [
      'census-acs',
      'census-cbp-zbp',
      'bls-oews',
      'bls-lau',
      'fema-nri-nfhl',
      'usgs-3dep',
      'epa-aqs',
      'dot-bts-access',
      'osm-commercial',
    ];

    const seedSources: EconomicSourceId[] = [
      'census-acs',
      'census-cbp-zbp',
      'bls-oews',
      'bls-lau',
      'fema-nri-nfhl',
      'osm-commercial',
    ];

    for (const id of expectedSources) {
      expect(isEconomicSourceRegistered(id)).toBe(true);
      const source = getEconomicSource(id);
      expect(source.id).toBe(id);
      expect(source.name.length).toBeGreaterThan(0);
      expect(source.agency.length).toBeGreaterThan(0);
      expect(source.canonical_url.startsWith('https://')).toBe(true);
      expect(source.terms_url.startsWith('https://')).toBe(true);
      expect(source.license_id.length).toBeGreaterThan(0);
      expect(source.attribution_notice.length).toBeGreaterThan(0);
      expect(source.supported_geographies.length).toBeGreaterThan(0);

      if (seedSources.includes(id)) {
        expect(source.status).toBe('seed');
        expect(source.seed_fixture_id).toBeDefined();
        expect(source.seed_fixture_id?.length).toBeGreaterThan(0);
      } else {
        expect(source.status).toBe('planned');
      }
    }
  });

  it('lists all sources cleanly', () => {
    const list = listEconomicSources();
    expect(list.length).toBe(9);
    const ids = list.map((s) => s.id);
    expect(ids).toContain('census-acs');
    expect(ids).toContain('census-cbp-zbp');
    expect(ids).toContain('bls-oews');
  });

  it('throws descriptive error on unregistered source lookup', () => {
    expect(() => getEconomicSource('unknown-source' as EconomicSourceId)).toThrow(
      /Unknown economic source ID: unknown-source/
    );
    expect(isEconomicSourceRegistered('invalid-id')).toBe(false);
  });

  it('preserves suppression capabilities in registry metadata', () => {
    expect(ECONOMIC_SOURCE_REGISTRY['census-acs'].margin_of_error_supported).toBe(true);
    expect(ECONOMIC_SOURCE_REGISTRY['census-acs'].suppression_supported).toBe(true);
    expect(ECONOMIC_SOURCE_REGISTRY['census-cbp-zbp'].suppression_supported).toBe(true);
    expect(ECONOMIC_SOURCE_REGISTRY['census-cbp-zbp'].margin_of_error_supported).toBe(false);
  });
});
