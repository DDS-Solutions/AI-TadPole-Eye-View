import { describe, expect, it } from 'vitest';
import { CENSUS_ACS_DEFAULT_VINTAGE, type EconomicGeography } from '@gev/contracts';
import {
  CensusAcsAdapter,
  CensusAcsInvalidQueryError,
  CensusAcsProviderDisabledError,
  CensusAcsSeedModeViolationError,
} from '../src/index.js';

describe('Census ACS Provider Adapter (PLAN.md §10 Task 9.1 & ADR 0052)', () => {
  it('initializes in seed mode by default with valid dictionary and kill switch active', () => {
    const adapter = new CensusAcsAdapter();
    expect(adapter.isEnabled()).toBe(true);
    expect(adapter.isSeedMode()).toBe(true);

    const dict = adapter.getVariableDictionary();
    expect(dict.version).toBe('1.0.0');
    expect(dict.acs_release).toBe('acs5');
    expect(dict.vintages_supported).toContain(CENSUS_ACS_DEFAULT_VINTAGE);
  });

  it('queries Census ACS estimates across county geography', async () => {
    const adapter = new CensusAcsAdapter();
    const countyGeo: EconomicGeography = {
      level: 'county',
      county_fips: '48453',
      state_fips: '48',
      name: 'Travis County, TX',
    };

    const records = await adapter.query({
      geography: countyGeo,
      variables: ['B19013_001E', 'total-population'],
      vintage: CENSUS_ACS_DEFAULT_VINTAGE,
    });

    expect(records.length).toBe(2);

    const income = records.find((r) => r.metric_id === 'median-household-income');
    expect(income).toBeDefined();
    expect(income?.estimate.status).toBe('available');
    if (income?.estimate.status === 'available') {
      expect(income.estimate.value).toBe(92450);
      expect(income.estimate.margin_of_error).toBe(1850);
      expect(income.estimate.confidence_level).toBe(0.9);
      expect(income.estimate.unit).toBe('USD');
    }

    const pop = records.find((r) => r.metric_id === 'total-population');
    expect(pop).toBeDefined();
    expect(pop?.estimate.status).toBe('available');
    if (pop?.estimate.status === 'available') {
      expect(pop.estimate.value).toBe(1326437);
      expect(pop.estimate.margin_of_error).toBe(0);
    }
  });

  it('queries Census ACS estimates across tract geography and preserves small-sample suppression without zero coercion', async () => {
    const adapter = new CensusAcsAdapter();
    const tractGeo: EconomicGeography = {
      level: 'tract',
      tract_fips: '48453001100',
      name: 'Census Tract 11, Travis County, TX',
    };

    const records = await adapter.query({
      geography: tractGeo,
      variables: ['B19013_001E', 'specialized-bracket-income'],
    });

    expect(records.length).toBe(2);

    const suppressed = records.find((r) => r.metric_id === 'specialized-bracket-income');
    expect(suppressed).toBeDefined();
    expect(suppressed?.estimate.status).toBe('suppressed');
    if (suppressed?.estimate.status === 'suppressed') {
      expect(suppressed.estimate.reason).toBe('small_sample');
      expect(suppressed.estimate.unit).toBe('USD');
    }
  });

  it('queries Census ACS estimates across ZCTA geography', async () => {
    const adapter = new CensusAcsAdapter();
    const zctaGeo: EconomicGeography = {
      level: 'zcta',
      zcta: '78701',
      name: 'ZCTA 78701, Austin, TX',
    };

    const records = await adapter.query({
      geography: zctaGeo,
      variables: ['B19013_001E'],
    });

    expect(records.length).toBe(1);
    const zctaRecord = records[0];
    expect(zctaRecord.geography.level).toBe('zcta');
    expect(zctaRecord.estimate.status).toBe('available');
    if (zctaRecord.estimate.status === 'available') {
      expect(zctaRecord.estimate.value).toBe(118500);
      expect(zctaRecord.estimate.margin_of_error).toBe(4200);
    }
  });

  it('queries Census ACS estimates across place geography', async () => {
    const adapter = new CensusAcsAdapter();
    const placeGeo: EconomicGeography = {
      level: 'place',
      place_fips: '4805000',
      name: 'Austin city, TX',
    };

    const records = await adapter.query({
      geography: placeGeo,
      variables: ['foreign-born-population'],
    });

    expect(records.length).toBe(1);
    const placeRecord = records[0];
    expect(placeRecord.geography.level).toBe('place');
    expect(placeRecord.metric_id).toBe('foreign-born-population');
    expect(placeRecord.estimate.status).toBe('available');
    if (placeRecord.estimate.status === 'available') {
      expect(placeRecord.estimate.value).toBe(182400);
    }
  });

  it('verifies statutory foreign-born definition (Table B05002) via getForeignBornPopulation', async () => {
    const adapter = new CensusAcsAdapter();
    const countyGeo: EconomicGeography = {
      level: 'county',
      county_fips: '48453',
      state_fips: '48',
    };

    const foreignBorn = await adapter.getForeignBornPopulation(countyGeo);
    expect(foreignBorn).toBeDefined();
    expect(foreignBorn?.variable_name).toBe('B05002_003E');
    expect(foreignBorn?.metric_id).toBe('foreign-born-population');

    // Statutory rule: must explicitly state naturalized citizens AND non-citizens
    const labelAndNotes =
      `${foreignBorn?.label} ${foreignBorn?.estimate.notes ?? ''}`.toLowerCase();
    expect(labelAndNotes).toContain('naturalized');
    expect(labelAndNotes).toContain('non-citizen');
    expect(labelAndNotes).not.toBe('non-citizens only');
  });

  it('fails closed immediately on malformed FIPS codes or state mismatches', async () => {
    const adapter = new CensusAcsAdapter();

    // 4-digit county FIPS
    await expect(
      adapter.query({
        geography: {
          level: 'county',
          county_fips: '4845',
        },
        variables: ['B19013_001E'],
      })
    ).rejects.toThrow();

    // State mismatch
    await expect(
      adapter.query({
        geography: {
          level: 'county',
          county_fips: '48453',
          state_fips: '06',
        },
        variables: ['B19013_001E'],
      })
    ).rejects.toThrow();

    // Malformed tract FIPS (not 11 digits)
    await expect(
      adapter.query({
        geography: {
          level: 'tract',
          tract_fips: '48453001',
        },
        variables: ['B19013_001E'],
      })
    ).rejects.toThrow();
  });

  it('fails closed immediately on unsupported vintage', async () => {
    const adapter = new CensusAcsAdapter();
    await expect(
      adapter.query({
        geography: {
          level: 'county',
          county_fips: '48453',
        },
        variables: ['B19013_001E'],
        vintage: '2010-2014', // Unsupported
      })
    ).rejects.toThrow(CensusAcsInvalidQueryError);
  });

  it('enforces strict seed mode and blocks unauthorized live calls', async () => {
    const liveAdapter = new CensusAcsAdapter({
      seedMode: false,
      allowLiveCalls: false,
    });

    await expect(
      liveAdapter.query({
        geography: {
          level: 'county',
          county_fips: '48453',
        },
        variables: ['B19013_001E'],
      })
    ).rejects.toThrow(CensusAcsSeedModeViolationError);
  });

  it('enforces kill switch when disabled (GEV_CENSUS_ACS_ENABLED=0)', async () => {
    const disabledAdapter = new CensusAcsAdapter({ enabled: false });
    expect(disabledAdapter.isEnabled()).toBe(false);

    await expect(
      disabledAdapter.query({
        geography: {
          level: 'county',
          county_fips: '48453',
        },
        variables: ['B19013_001E'],
      })
    ).rejects.toThrow(CensusAcsProviderDisabledError);

    await expect(
      disabledAdapter.getEvidenceByGeography({
        level: 'county',
        county_fips: '48453',
      })
    ).rejects.toThrow(CensusAcsProviderDisabledError);
  });

  it('performance threshold: parses and queries ACS dataset under 10ms p95 across 100 iterations', async () => {
    const adapter = new CensusAcsAdapter();
    const countyGeo: EconomicGeography = {
      level: 'county',
      county_fips: '48453',
      state_fips: '48',
    };

    // Warm up
    await adapter.query({
      geography: countyGeo,
      variables: ['B19013_001E'],
    });

    const iterations = 100;
    const durations: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await adapter.query({
        geography: countyGeo,
        variables: ['B19013_001E', 'total-population', 'foreign-born-population'],
      });
      const end = performance.now();
      durations.push(end - start);
    }

    durations.sort((a, b) => a - b);
    const p50 = durations[Math.floor(iterations * 0.5)];
    const p95 = durations[Math.floor(iterations * 0.95)];

    console.log(
      `[BENCHMARK] Census ACS Query Latency (N=${iterations}): p50=${p50.toFixed(3)}ms, p95=${p95.toFixed(3)}ms`
    );

    expect(p95).toBeLessThan(10); // Required threshold: < 10ms p95
  });
});
