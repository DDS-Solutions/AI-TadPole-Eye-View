import { describe, expect, it } from 'vitest';
import {
  BusinessContextInputSchema,
  BusinessContextPreviewSchema,
  ECONOMIC_LEGAL_DISCLAIMER,
  ECONOMIC_SCHEMA_VERSION,
  EconomicEstimateSchema,
  EconomicEvidenceBundleSchema,
  EconomicEvidenceRecordSchema,
  EconomicGeographySchema,
} from '../src/index.js';

const mockProvenance = {
  schema_version: 1,
  source: {
    provider_id: 'census-acs',
    feed_id: 'economic-indicators',
    name: 'US Census Bureau ACS 5-Year',
    canonical_url: 'https://api.census.gov/data',
  },
  retrieved_at: '2026-09-16T12:00:00.000Z',
  observation_period: {
    status: 'available',
    start: '2021-01-01T00:00:00.000Z',
    end: '2025-12-31T23:59:59.000Z',
  },
  vintage: {
    status: 'available',
    value: '2021-2025 ACS 5-Year Estimates',
  },
  mode: 'seed',
  source_mode: 'seed',
  license: { id: 'us-public-domain', name: 'US Government Work Public Domain' },
  attribution: 'U.S. Census Bureau',
  fixture_id: 'acs-5yr-fixtures-v1',
  cache: null,
  freshness: { status: 'fresh', age_seconds: 100, fresh_for_seconds: 86400 },
} as const;

describe('Economic Geography Limits & Fail-Closed Behavior', () => {
  it('fails closed on malformed or malicious geographic identifiers', () => {
    // Malformed state FIPS
    expect(EconomicGeographySchema.safeParse({ level: 'state', state_fips: '6' }).success).toBe(
      false
    );
    expect(EconomicGeographySchema.safeParse({ level: 'state', state_fips: '061' }).success).toBe(
      false
    );
    expect(EconomicGeographySchema.safeParse({ level: 'state', state_fips: 'CA' }).success).toBe(
      false
    );
    expect(
      EconomicGeographySchema.safeParse({ level: 'state', state_fips: '01; DROP TABLE users;' })
        .success
    ).toBe(false);

    // Malformed county FIPS
    expect(
      EconomicGeographySchema.safeParse({ level: 'county', county_fips: '0607' }).success
    ).toBe(false);
    expect(
      EconomicGeographySchema.safeParse({ level: 'county', county_fips: '060751' }).success
    ).toBe(false);
    expect(
      EconomicGeographySchema.safeParse({ level: 'county', county_fips: '06075', state_fips: '36' })
        .success
    ).toBe(false);
    expect(
      EconomicGeographySchema.safeParse({ level: 'county', county_fips: '06075/../../etc/passwd' })
        .success
    ).toBe(false);

    // Malformed tract & block group FIPS
    expect(
      EconomicGeographySchema.safeParse({ level: 'tract', tract_fips: '0607501790' }).success
    ).toBe(false);
    expect(
      EconomicGeographySchema.safeParse({ level: 'tract', tract_fips: '0607501790299' }).success
    ).toBe(false);
    expect(
      EconomicGeographySchema.safeParse({ level: 'tract', tract_fips: '<script>alert(1)</script>' })
        .success
    ).toBe(false);
    expect(
      EconomicGeographySchema.safeParse({ level: 'block_group', block_group_fips: '06075017902' })
        .success
    ).toBe(false);

    // Malformed ZCTA, CBSA, Place
    expect(EconomicGeographySchema.safeParse({ level: 'zcta', zcta: '9410' }).success).toBe(false);
    expect(EconomicGeographySchema.safeParse({ level: 'zcta', zcta: '941031' }).success).toBe(
      false
    );
    expect(EconomicGeographySchema.safeParse({ level: 'zcta', zcta: '9410A' }).success).toBe(false);
    expect(EconomicGeographySchema.safeParse({ level: 'cbsa', cbsa_code: '4186' }).success).toBe(
      false
    );
    expect(
      EconomicGeographySchema.safeParse({ level: 'place', place_fips: '066700' }).success
    ).toBe(false);

    // Coordinates and Bounding Box limits
    expect(
      EconomicGeographySchema.safeParse({ level: 'point', latitude: 90.001, longitude: 0 }).success
    ).toBe(false);
    expect(
      EconomicGeographySchema.safeParse({ level: 'point', latitude: -90.1, longitude: 0 }).success
    ).toBe(false);
    expect(
      EconomicGeographySchema.safeParse({ level: 'point', latitude: 0, longitude: 180.5 }).success
    ).toBe(false);
    expect(
      EconomicGeographySchema.safeParse({ level: 'point', latitude: 0, longitude: -180.1 }).success
    ).toBe(false);
    expect(
      EconomicGeographySchema.safeParse({ level: 'point', latitude: Number.NaN, longitude: 0 })
        .success
    ).toBe(false);
    expect(
      EconomicGeographySchema.safeParse({
        level: 'point',
        latitude: Number.POSITIVE_INFINITY,
        longitude: 0,
      }).success
    ).toBe(false);

    expect(
      EconomicGeographySchema.safeParse({
        level: 'bounding_box',
        min_lat: 40.0,
        max_lat: 30.0,
        min_lon: -100.0,
        max_lon: -90.0,
      }).success
    ).toBe(false);
    expect(
      EconomicGeographySchema.safeParse({
        level: 'bounding_box',
        min_lat: 30.0,
        max_lat: 40.0,
        min_lon: -80.0,
        max_lon: -90.0,
      }).success
    ).toBe(false);
  });
});

describe('Economic Estimate Limits & Zero-Coercion Prohibition', () => {
  it('rejects unexpected value fields in suppressed, unavailable, or not_applicable estimates', () => {
    expect(
      EconomicEstimateSchema.safeParse({
        status: 'suppressed',
        reason: 'disclosure_avoidance',
        detail: 'Suppressed',
        value: 0,
      }).success
    ).toBe(false);

    expect(
      EconomicEstimateSchema.safeParse({
        status: 'unavailable',
        reason: 'Data source offline',
        value: 0,
      }).success
    ).toBe(false);

    expect(
      EconomicEstimateSchema.safeParse({
        status: 'not_applicable',
        reason: 'Not applicable',
        value: 0,
      }).success
    ).toBe(false);
  });

  it('enforces bounds and value integrity on estimates', () => {
    // Inverted suppression bounds
    expect(
      EconomicEstimateSchema.safeParse({
        status: 'suppressed',
        reason: 'disclosure_avoidance',
        detail: 'Bounds inverted',
        bounds: { lower_bound: 100, upper_bound: 20 },
      }).success
    ).toBe(false);

    // Non-finite value
    expect(
      EconomicEstimateSchema.safeParse({
        status: 'available',
        value: Number.NaN,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'USD',
      }).success
    ).toBe(false);

    // Negative margin of error
    expect(
      EconomicEstimateSchema.safeParse({
        status: 'available',
        value: 50000,
        margin_of_error: -10,
        confidence_level: 0.9,
        sample_size: 100,
        unit: 'USD',
      }).success
    ).toBe(false);

    // Out of range confidence level
    expect(
      EconomicEstimateSchema.safeParse({
        status: 'available',
        value: 50000,
        margin_of_error: 500,
        confidence_level: 1.5,
        sample_size: 100,
        unit: 'USD',
      }).success
    ).toBe(false);
  });
});

describe('BusinessContext & Provenance Limits', () => {
  const validInput = {
    business_name: 'Acme Precision Manufacturing, LLC',
    naics_code: '332710',
    industry_title: 'Machine Shops',
    target_geography: { level: 'county' as const, county_fips: '06075' },
    operating_radius_meters: 25000,
    employee_count_estimate: 45,
    annual_revenue_usd_estimate: 8500000,
  };

  it('rejects invalid NAICS codes', () => {
    expect(BusinessContextInputSchema.safeParse({ ...validInput, naics_code: '3' }).success).toBe(
      false
    );
    expect(
      BusinessContextInputSchema.safeParse({ ...validInput, naics_code: '3327101' }).success
    ).toBe(false);
    expect(
      BusinessContextInputSchema.safeParse({ ...validInput, naics_code: '3327AB' }).success
    ).toBe(false);
    expect(
      BusinessContextInputSchema.safeParse({ ...validInput, naics_code: '332710; DROP TABLE;' })
        .success
    ).toBe(false);
  });

  it('requires exact legal disclaimer and fails closed on missing/altered text', () => {
    const preview = {
      schema_version: ECONOMIC_SCHEMA_VERSION,
      preview_id: 'prev-acme-mfg-001',
      tenant_id: 'tenant-mfg-corp',
      generated_at: '2026-09-16T12:10:00.000Z',
      input: validInput,
      evidence: [],
      summary_estimates: {},
      provenance: mockProvenance,
      warnings: [],
      disclaimer: ECONOMIC_LEGAL_DISCLAIMER,
    };

    expect(
      BusinessContextPreviewSchema.safeParse({
        ...preview,
        disclaimer: 'Guaranteed accuracy.',
      }).success
    ).toBe(false);

    const missingDisclaimer = { ...preview } as Record<string, unknown>;
    delete missingDisclaimer.disclaimer;
    expect(BusinessContextPreviewSchema.safeParse(missingDisclaimer).success).toBe(false);
  });

  it('fails closed when required DataProvenance is omitted', () => {
    const recordPayload = {
      evidence_id: 'ev-income-01',
      source_id: 'census-acs',
      metric_id: 'median-household-income',
      variable_name: 'B19013_001E',
      label: 'Median Household Income',
      geography: { level: 'county' as const, county_fips: '06075' },
      estimate: {
        status: 'available' as const,
        value: 100000,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'USD',
      },
      tags: [],
    };
    expect(EconomicEvidenceRecordSchema.safeParse(recordPayload).success).toBe(false);

    const bundlePayload = {
      bundle_id: 'bundle-01',
      tenant_id: 'tenant-01',
      title: 'Bundle',
      target_geography: { level: 'county' as const, county_fips: '06075' },
      records: [{ ...recordPayload, provenance: mockProvenance }],
      created_at: '2026-09-16T12:00:00.000Z',
    };
    expect(EconomicEvidenceBundleSchema.safeParse(bundlePayload).success).toBe(false);
  });
});

describe('Performance Benchmark (< 5ms p95)', () => {
  it('parses and round-trips 1,000 complex economic records with p95 < 5ms', () => {
    const recordPayload = {
      evidence_id: 'ev-benchmark-001',
      source_id: 'census-acs',
      metric_id: 'median-household-income',
      variable_name: 'B19013_001E',
      label: 'Median Household Income Benchmark',
      geography: {
        level: 'county' as const,
        county_fips: '06075',
        state_fips: '06',
        name: 'San Francisco County',
      },
      estimate: {
        status: 'available' as const,
        value: 136689,
        margin_of_error: 3412,
        confidence_level: 0.9,
        sample_size: 4200,
        unit: 'USD',
      },
      provenance: mockProvenance,
      tags: ['benchmark'],
    };

    const iterations = 1000;
    const durationsMs: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const parsed = EconomicEvidenceRecordSchema.parse(recordPayload);
      JSON.stringify(parsed);
      const end = performance.now();
      durationsMs.push(end - start);
    }

    durationsMs.sort((a, b) => a - b);
    const p95 = durationsMs[Math.floor(iterations * 0.95)] ?? 0;
    expect(p95).toBeLessThan(5.0);
  });
});
