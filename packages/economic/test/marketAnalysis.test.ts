import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ECONOMIC_LEGAL_DISCLAIMER,
  type EconomicEvidenceRecord,
  type EconomicGeography,
  type OsmCommercialFootprintSummary,
} from '@gev/contracts';
import { describe, expect, it } from 'vitest';
import { parseEconomicFixtureDataset } from '../src/fixtureParser.js';
import { analyzeMarketContext } from '../src/marketAnalysis.js';
import { synthesizeMultiSourceEvidenceBundle } from '../src/multiSourceEvidence.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesRoot = path.resolve(__dirname, '../../../fixtures');

function loadFixture(name: string) {
  const filePath = path.join(fixturesRoot, name);
  return parseEconomicFixtureDataset(fs.readFileSync(filePath, 'utf8'));
}

describe('Deterministic Market Context & Evidence Synthesis (Task 9.4 & ADR 0058)', () => {
  const mockClockTimestamp = '2026-09-21T12:00:00.000Z';

  const mockGeographyTravis: EconomicGeography = {
    level: 'county',
    county_fips: '48453',
    state_fips: '48',
    name: 'Travis County, TX',
  };

  const mockProvenance = {
    schema_version: 1 as const,
    source: {
      provider_id: 'census-acs',
      feed_id: 'acs-5yr-profiles',
      name: 'U.S. Census Bureau ACS 5-Year Estimates',
      canonical_url: 'https://api.census.gov/data',
    },
    retrieved_at: mockClockTimestamp,
    observation_period: {
      status: 'available' as const,
      start: '2020-01-01T00:00:00.000Z',
      end: '2024-12-31T23:59:59.000Z',
    },
    vintage: {
      status: 'available' as const,
      value: '2020-2024 ACS 5-Year Detailed Tables',
    },
    mode: 'seed' as const,
    source_mode: 'seed' as const,
    license: {
      id: 'us-government-public-domain',
      name: 'U.S. Government Work (Public Domain)',
    },
    attribution: 'U.S. Census Bureau ACS',
    fixture_id: 'census-acs-synthetic-v1',
    cache: null,
    freshness: {
      status: 'fresh' as const,
      age_seconds: 0,
      fresh_for_seconds: 86400,
    },
  };

  const mockAcsEvidence: EconomicEvidenceRecord[] = [
    {
      evidence_id: 'ev-pop-48453',
      source_id: 'census-acs',
      metric_id: 'total-population',
      variable_name: 'B01003_001E',
      label: 'Total Population',
      geography: mockGeographyTravis,
      estimate: {
        status: 'available',
        value: 1290188,
        margin_of_error: 0,
        confidence_level: 0.9,
        sample_size: null,
        unit: 'persons',
      },
      provenance: mockProvenance,
    },
    {
      evidence_id: 'ev-income-48453',
      source_id: 'census-acs',
      metric_id: 'median-household-income',
      variable_name: 'B19013_001E',
      label: 'Median Household Income',
      geography: mockGeographyTravis,
      estimate: {
        status: 'available',
        value: 92400,
        margin_of_error: 1500,
        confidence_level: 0.9,
        sample_size: null,
        unit: 'USD',
      },
      provenance: mockProvenance,
    },
  ];

  const mockCbpEvidence: EconomicEvidenceRecord[] = [
    {
      evidence_id: 'ev-estab-48453',
      source_id: 'census-cbp-zbp',
      metric_id: 'establishment-count',
      variable_name: 'ESTAB',
      label: 'Total Establishments',
      geography: mockGeographyTravis,
      estimate: {
        status: 'available',
        value: 38200,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'establishments',
      },
      provenance: {
        ...mockProvenance,
        source: {
          ...mockProvenance.source,
          provider_id: 'census-cbp-zbp',
          feed_id: 'cbp-county-totals',
          name: 'U.S. Census Bureau CBP',
        },
      },
    },
    {
      evidence_id: 'ev-emp-48453',
      source_id: 'census-cbp-zbp',
      metric_id: 'paid-employment',
      variable_name: 'EMP',
      label: 'Total Paid Employment',
      geography: mockGeographyTravis,
      estimate: {
        status: 'available',
        value: 650000,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'employees',
      },
      provenance: mockProvenance,
    },
    {
      evidence_id: 'ev-pay-48453',
      source_id: 'census-cbp-zbp',
      metric_id: 'annual-payroll',
      variable_name: 'PAYANN',
      label: 'Total Annual Payroll',
      geography: mockGeographyTravis,
      estimate: {
        status: 'available',
        value: 52000000, // $52 billion in thousands
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'USD_thousands',
      },
      provenance: mockProvenance,
    },
  ];

  const mockOsmFootprint: OsmCommercialFootprintSummary = {
    total_features: 1540,
    category_counts: {
      food_and_beverage: 650,
      retail: 420,
      services: 230,
      office: 120,
      craft_industrial: 40,
      healthcare: 50,
      hospitality: 30,
      other_commercial: 0,
    },
    density_per_km2: 24.5,
    area_km2: 62.85,
    top_amenities: [
      { tag: 'amenity=restaurant', count: 320 },
      { tag: 'amenity=cafe', count: 180 },
    ],
  };

  describe('Multi-Source Evidence Bundle Synthesis', () => {
    it('synthesizes compliant evidence bundle from multiple sources', () => {
      const allRecords = [...mockAcsEvidence, ...mockCbpEvidence];
      const bundle = synthesizeMultiSourceEvidenceBundle({
        bundleId: 'bundle-test-01',
        tenantId: 'tenant-demo',
        title: 'Multi-Source Synthesis Bundle',
        targetGeography: mockGeographyTravis,
        records: allRecords,
        isoTimestamp: mockClockTimestamp,
      });

      expect(bundle.bundle_id).toBe('bundle-test-01');
      expect(bundle.records.length).toBe(allRecords.length);
      expect(bundle.provenance.mode).toBe('seed');
    });

    it('throws RangeError if records array is empty', () => {
      expect(() =>
        synthesizeMultiSourceEvidenceBundle({
          bundleId: 'bundle-empty',
          tenantId: 'tenant-demo',
          title: 'Empty Bundle',
          targetGeography: mockGeographyTravis,
          records: [],
          isoTimestamp: mockClockTimestamp,
        })
      ).toThrow(RangeError);
    });
  });

  describe('Pure Market Analysis Engine (analyzeMarketContext)', () => {
    it('computes complete market summary, average wage, and derived ratios', () => {
      const result = analyzeMarketContext(
        {
          tenant_id: 'tenant-demo',
          target_geography: mockGeographyTravis,
          acs_evidence: mockAcsEvidence,
          cbp_evidence: mockCbpEvidence,
          osm_footprint: mockOsmFootprint,
          benchmark_density_expectation: 20.0,
        },
        mockClockTimestamp
      );

      expect(result.schema_version).toBe(1);
      expect(result.disclaimer).toBe(ECONOMIC_LEGAL_DISCLAIMER);
      expect(result.demographics.total_population.status).toBe('available');
      if (result.demographics.total_population.status === 'available') {
        expect(result.demographics.total_population.value).toBe(1290188);
      }

      // Average wage: payroll $52B / 650k employees = $80,000
      expect(result.business_activity.average_annual_wage_usd.status).toBe('available');
      if (result.business_activity.average_annual_wage_usd.status === 'available') {
        expect(result.business_activity.average_annual_wage_usd.value).toBe(80000);
      }

      // Population per establishment: 1,290,188 / 38,200 = 33.8
      expect(result.derived_metrics.population_per_establishment.status).toBe('available');
      if (result.derived_metrics.population_per_establishment.status === 'available') {
        expect(result.derived_metrics.population_per_establishment.value).toBe(33.8);
      }

      // Disagreement state: benchmark density expectation (20) vs observed (24.5)
      expect(result.disagreement_state.has_disagreements).toBe(true);
      expect(result.disagreement_state.by_severity.warning).toBeGreaterThanOrEqual(1);
      const densityDis = result.disagreement_state.records.find(
        (r) => r.indicator_key === 'commercial_density'
      );
      expect(densityDis).toBeDefined();
      expect(densityDis?.resolution_state).toBe('unresolved_preserved');
    });

    it('strictly enforces zero-coercion when CBP payroll or employment is suppressed', () => {
      const suppressedCbpEvidence: EconomicEvidenceRecord[] = [
        {
          ...mockCbpEvidence[0]!,
          metric_id: 'establishment-count',
          estimate: {
            status: 'suppressed',
            reason: 'disclosure_avoidance',
            detail: 'Withheld to protect privacy',
          },
        },
        {
          ...mockCbpEvidence[1]!,
          metric_id: 'paid-employment',
          estimate: {
            status: 'suppressed',
            reason: 'disclosure_avoidance',
            detail: 'Employment withheld',
          },
        },
      ];

      const result = analyzeMarketContext(
        {
          tenant_id: 'tenant-demo',
          target_geography: mockGeographyTravis,
          acs_evidence: mockAcsEvidence,
          cbp_evidence: suppressedCbpEvidence,
          osm_footprint: mockOsmFootprint,
        },
        mockClockTimestamp
      );

      // Average annual wage MUST be suppressed, NEVER coerced to 0!
      expect(result.business_activity.average_annual_wage_usd.status).toBe('suppressed');
      expect('value' in result.business_activity.average_annual_wage_usd).toBe(false);

      // Population per establishment MUST be suppressed, NEVER coerced to 0!
      expect(result.derived_metrics.population_per_establishment.status).toBe('suppressed');
      expect('value' in result.derived_metrics.population_per_establishment).toBe(false);
    });
  });

  describe('Integration with Seed Fixtures (Task 8.3 / Task 9.4)', () => {
    it('synthesizes market context using actual synthetic fixture datasets', () => {
      const acsFixture = loadFixture('census-acs-synthetic-v1.json');
      const cbpFixture = loadFixture('census-cbp-zbp-synthetic-v1.json');

      const result = analyzeMarketContext(
        {
          tenant_id: 'tenant-seed-demo',
          target_geography: acsFixture.target_geography,
          acs_evidence: acsFixture.records,
          cbp_evidence: cbpFixture.records,
          osm_footprint: mockOsmFootprint,
          benchmark_density_expectation: 25.0,
        },
        mockClockTimestamp
      );

      expect(result.schema_version).toBe(1);
      expect(result.evidence_bundle.records.length).toBeGreaterThan(5);
      expect(result.evidence_bundle.provenance.mode).toBe('seed');
    });
  });
});
