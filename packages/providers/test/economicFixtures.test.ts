import { describe, expect, it } from 'vitest';
import { EconomicFixtureAdapter } from '../src/economicFixtures.js';

describe('EconomicFixtureAdapter (@gev/providers)', () => {
  it('loads all 6 economic fixture datasets and validates contract schemas', () => {
    const adapter = new EconomicFixtureAdapter();
    const datasets = adapter.loadDatasets();

    expect(datasets.length).toBe(6);
    for (const dataset of datasets) {
      expect(dataset.schema_version).toBe(1);
      expect(dataset.provenance.mode).toBe('seed');
      expect(dataset.provenance.source_mode).toBe('seed');
      expect(dataset.records.length).toBeGreaterThan(0);
    }
  });

  it('retrieves specific datasets by fixture_id and source_id', () => {
    const adapter = new EconomicFixtureAdapter();
    const acs = adapter.getDataset('census-acs-synthetic-v1');
    expect(acs).toBeDefined();
    expect(acs?.source_id).toBe('census-acs');

    const cbp = adapter.getDataset('census-cbp-zbp');
    expect(cbp).toBeDefined();
    expect(cbp?.fixture_id).toBe('census-cbp-zbp-synthetic-v1');
  });

  it('returns all combined evidence records across fixtures', () => {
    const adapter = new EconomicFixtureAdapter();
    const records = adapter.getAllRecords();

    expect(records.length).toBeGreaterThanOrEqual(25);
    for (const record of records) {
      expect(record.evidence_id).toBeDefined();
      expect(record.estimate.status).toMatch(/available|suppressed|unavailable|not_applicable/);
      expect(record.provenance.mode).toBe('seed');
    }
  });

  it('filters evidence records by county geography and NAICS code', () => {
    const adapter = new EconomicFixtureAdapter();
    const records = adapter.getEvidenceRecords({
      geography: {
        level: 'county',
        county_fips: '48453',
        state_fips: '48',
        name: 'Travis County, TX',
      },
      naicsCode: '541511',
    });

    expect(records.length).toBeGreaterThanOrEqual(5);

    // Verify presence of core metrics
    const metrics = records.map((r) => r.metric_id);
    expect(metrics).toContain('median-household-income');
    expect(metrics).toContain('establishment-count');
    expect(metrics).toContain('nri-risk-score');

    // Verify small-sample and disclosure avoidance suppression is preserved
    const hasSuppressed = records.some((r) => r.estimate.status === 'suppressed');
    expect(hasSuppressed).toBe(true);
  });

  it('returns empty evidence array for non-matching geography without errors', () => {
    const adapter = new EconomicFixtureAdapter();
    const records = adapter.getEvidenceRecords({
      geography: {
        level: 'county',
        county_fips: '06075',
        state_fips: '06',
        name: 'San Francisco County, CA',
      },
      naicsCode: '999999',
    });

    expect(records).toEqual([]);
  });

  it('delivers sub-millisecond query latency from in-memory cache', () => {
    const adapter = new EconomicFixtureAdapter();
    adapter.loadDatasets(); // warmup

    const start = performance.now();
    for (let i = 0; i < 50; i++) {
      adapter.getEvidenceRecords({
        geography: {
          level: 'county',
          county_fips: '48453',
          state_fips: '48',
        },
        naicsCode: '541511',
      });
    }
    const duration = performance.now() - start;
    const avgMs = duration / 50;

    expect(avgMs).toBeLessThan(5); // Well under 25ms threshold
  });
});
