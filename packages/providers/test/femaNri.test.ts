import { describe, expect, it } from 'vitest';
import {
  type EconomicGeography,
  FEMA_NRI_DEFAULT_VINTAGE,
  FEMA_NRI_SCREENING_DISCLAIMER,
} from '@gev/contracts';
import {
  FEMA_NRI_FEED_ID,
  FEMA_NRI_PROVIDER_ID,
  FemaNriAdapter,
  FemaNriProviderDisabledError,
  FemaNriSeedModeViolationError,
} from '../src/index.js';

describe('FEMA NRI Provider Adapter (PLAN.md §10 Task 11.1 & ADR 0062)', () => {
  it('initializes in seed mode by default with valid dictionary and screening disclaimer', () => {
    const adapter = new FemaNriAdapter();
    expect(adapter.isEnabled()).toBe(true);
    expect(adapter.isSeedMode()).toBe(true);

    const dict = adapter.getVariableDictionary();
    expect(dict.version).toBe('1.0.0');
    expect(dict.program).toBe('fema_nri');
    expect(dict.vintages_supported).toContain(FEMA_NRI_DEFAULT_VINTAGE);
    expect(Object.keys(dict.variables).length).toBeGreaterThanOrEqual(10);

    expect(adapter.getScreeningDisclaimer()).toBe(FEMA_NRI_SCREENING_DISCLAIMER);
  });

  it('queries FEMA NRI risk estimates across county geography with variable filtering', async () => {
    const adapter = new FemaNriAdapter();
    const countyGeo: EconomicGeography = {
      level: 'county',
      county_fips: '48453',
      state_fips: '48',
      name: 'Travis County, TX',
    };

    const records = await adapter.query({
      geography: countyGeo,
      variables: ['RISK_SCORE', 'EAL_VALT', 'SOVI_SCORE', 'RESL_SCORE'],
    });

    expect(records.length).toBeGreaterThanOrEqual(4);

    const riskScore = records.find((r) => r.variable_name === 'RISK_SCORE');
    expect(riskScore).toBeDefined();
    expect(riskScore?.estimate.status).toBe('available');
    if (riskScore?.estimate.status === 'available') {
      expect(riskScore.estimate.value).toBe(24.8);
      expect(riskScore.estimate.unit).toBe('index_score');
    }

    const eal = records.find((r) => r.variable_name === 'EAL_VALT');
    expect(eal).toBeDefined();
    expect(eal?.estimate.status).toBe('available');
    if (eal?.estimate.status === 'available') {
      expect(eal.estimate.value).toBe(48600000);
      expect(eal.estimate.unit).toBe('USD');
    }

    // Provenance verification
    expect(riskScore?.provenance.source.provider_id).toBe(FEMA_NRI_PROVIDER_ID);
    expect(riskScore?.provenance.source.feed_id).toBe(FEMA_NRI_FEED_ID);
    expect(riskScore?.provenance.mode).toBe('seed');
  });

  it('queries FEMA NRI risk estimates across census tract geography', async () => {
    const adapter = new FemaNriAdapter();
    const tractGeo: EconomicGeography = {
      level: 'tract',
      tract_fips: '48453000101',
      name: 'Census Tract 1.01, Travis County, TX',
    };

    const records = await adapter.query({
      geography: tractGeo,
      variables: ['RISK_SCORE'],
    });

    expect(records.length).toBeGreaterThanOrEqual(1);
    const tractRisk = records.find((r) => r.variable_name === 'RISK_SCORE');
    expect(tractRisk).toBeDefined();
    expect(tractRisk?.estimate.status).toBe('available');
    if (tractRisk?.estimate.status === 'available') {
      expect(tractRisk.estimate.value).toBe(21.2);
    }
  });

  it('rejects unsupported geography levels with clear error', async () => {
    const adapter = new FemaNriAdapter();
    const cbsaGeo: EconomicGeography = {
      level: 'cbsa',
      cbsa_code: '12420',
      name: 'Austin-Round Rock-Georgetown, TX',
    };

    await expect(adapter.query({ geography: cbsaGeo })).rejects.toThrow(
      /FEMA NRI queries support geographies/i
    );
  });

  it('provides dedicated convenience accessors for core metrics', async () => {
    const adapter = new FemaNriAdapter();
    const countyGeo: EconomicGeography = {
      level: 'county',
      county_fips: '48453',
      state_fips: '48',
      name: 'Travis County, TX',
    };

    const composite = await adapter.getCompositeRisk(countyGeo);
    expect(composite).toBeDefined();
    expect(composite?.variable_name).toBe('RISK_SCORE');

    const eal = await adapter.getExpectedAnnualLoss(countyGeo);
    expect(eal).toBeDefined();
    expect(eal?.variable_name).toBe('EAL_VALT');

    const sovi = await adapter.getSocialVulnerability(countyGeo);
    expect(sovi).toBeDefined();
    expect(sovi?.variable_name).toBe('SOVI_SCORE');

    const resl = await adapter.getCommunityResilience(countyGeo);
    expect(resl).toBeDefined();
    expect(resl?.variable_name).toBe('RESL_SCORE');

    const riverine = await adapter.getHazardRisk(countyGeo, 'riverine_flooding');
    expect(riverine).toBeDefined();
    expect(riverine?.variable_name).toBe('RFLD_RISKS');
    if (riverine?.estimate.status === 'available') {
      expect(riverine.estimate.value).toBe(32.1);
    }
  });

  it('preserves not-applicable hazard ratings (inland tsunami) without zero-coercion', async () => {
    const adapter = new FemaNriAdapter();
    const countyGeo: EconomicGeography = {
      level: 'county',
      county_fips: '48453',
      state_fips: '48',
      name: 'Travis County, TX',
    };

    const tsunami = await adapter.getHazardRisk(countyGeo, 'tsunami');
    expect(tsunami).toBeDefined();
    expect(tsunami?.estimate.status).toBe('not_applicable');
    if (tsunami?.estimate.status === 'not_applicable') {
      expect(tsunami.estimate.reason).toContain('Hazard not applicable for inland geography');
    }
  });

  it('respects kill switch when provider is disabled', async () => {
    const disabledAdapter = new FemaNriAdapter({ enabled: false });
    expect(disabledAdapter.isEnabled()).toBe(false);

    const countyGeo: EconomicGeography = {
      level: 'county',
      county_fips: '48453',
    };

    await expect(disabledAdapter.query({ geography: countyGeo })).rejects.toThrow(
      FemaNriProviderDisabledError
    );
  });

  it('rejects live API requests in seed mode without explicit authorization', async () => {
    const liveAttemptAdapter = new FemaNriAdapter({
      seedMode: false,
      allowLiveCalls: false,
    });

    const countyGeo: EconomicGeography = {
      level: 'county',
      county_fips: '48453',
    };

    await expect(liveAttemptAdapter.query({ geography: countyGeo })).rejects.toThrow(
      FemaNriSeedModeViolationError
    );
  });

  it('proves p95 query latency is strictly < 25ms in seed mode (PLAN.md §10 Task 11.1)', async () => {
    const adapter = new FemaNriAdapter();
    const countyGeo: EconomicGeography = {
      level: 'county',
      county_fips: '48453',
      state_fips: '48',
      name: 'Travis County, TX',
    };

    // Warm-up query
    await adapter.query({ geography: countyGeo });

    const iterations = 100;
    const latencies: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await adapter.query({
        geography: countyGeo,
        variables: ['RISK_SCORE', 'EAL_VALT', 'SOVI_SCORE', 'RESL_SCORE'],
      });
      latencies.push(performance.now() - start);
    }

    latencies.sort((a, b) => a - b);
    const p95Index = Math.floor(latencies.length * 0.95);
    const p95 = latencies[p95Index];

    expect(p95).toBeLessThan(25);
  });
});
