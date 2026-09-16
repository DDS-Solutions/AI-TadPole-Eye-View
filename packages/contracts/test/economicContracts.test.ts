import { describe, expect, it } from 'vitest';
import {
  BusinessContextInputSchema,
  BusinessContextPreviewSchema,
  ECONOMIC_LEGAL_DISCLAIMER,
  ECONOMIC_SCHEMA_VERSION,
  EconomicDisagreementSchema,
  EconomicEstimateSchema,
  EconomicEvidenceBundleSchema,
  EconomicEvidenceRecordSchema,
  EconomicGeographySchema,
  getNumericEstimateValue,
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

describe('Economic Geography contracts', () => {
  it('validates nation, state, county, tract, point, and bounding_box geographies', () => {
    const nation = EconomicGeographySchema.parse({
      level: 'nation',
      country_code: 'US',
      name: 'United States',
    });
    expect(nation.level).toBe('nation');

    const state = EconomicGeographySchema.parse({
      level: 'state',
      state_fips: '06',
      state_postal: 'CA',
      name: 'California',
    });
    expect(state.level).toBe('state');

    const county = EconomicGeographySchema.parse({
      level: 'county',
      county_fips: '06075',
      state_fips: '06',
      name: 'San Francisco County',
    });
    expect(county.level).toBe('county');

    const tract = EconomicGeographySchema.parse({
      level: 'tract',
      tract_fips: '06075017902',
      name: 'Census Tract 179.02',
    });
    expect(tract.level).toBe('tract');

    const blockGroup = EconomicGeographySchema.parse({
      level: 'block_group',
      block_group_fips: '060750179021',
      name: 'Block Group 1',
    });
    expect(blockGroup.level).toBe('block_group');

    const zcta = EconomicGeographySchema.parse({
      level: 'zcta',
      zcta: '94103',
      name: 'ZCTA 94103',
    });
    expect(zcta.level).toBe('zcta');

    const cbsa = EconomicGeographySchema.parse({
      level: 'cbsa',
      cbsa_code: '41860',
      name: 'SF-Oakland, CA',
    });
    expect(cbsa.level).toBe('cbsa');

    const place = EconomicGeographySchema.parse({
      level: 'place',
      place_fips: '0667000',
      name: 'San Francisco',
    });
    expect(place.level).toBe('place');

    const point = EconomicGeographySchema.parse({
      level: 'point',
      latitude: 37.7749,
      longitude: -122.4194,
    });
    expect(point.level).toBe('point');

    const bbox = EconomicGeographySchema.parse({
      level: 'bounding_box',
      min_lat: 37.7,
      max_lat: 37.8,
      min_lon: -122.5,
      max_lon: -122.3,
    });
    expect(bbox.level).toBe('bounding_box');
  });
});

describe('Economic Estimate contracts & Zero-Coercion prohibition', () => {
  it('validates all 4 discriminated states: available, suppressed, unavailable, not_applicable', () => {
    const available = EconomicEstimateSchema.parse({
      status: 'available',
      value: 125000,
      margin_of_error: 4500,
      confidence_level: 0.9,
      sample_size: 1500,
      unit: 'USD',
      notes: 'Median household income',
    });
    expect(available.status).toBe('available');
    expect(available.value).toBe(125000);
    expect(getNumericEstimateValue(available)).toBe(125000);

    const suppressed = EconomicEstimateSchema.parse({
      status: 'suppressed',
      reason: 'disclosure_avoidance',
      detail: 'Census Title 13 disclosure avoidance rule applied',
      bounds: { lower_bound: 20, upper_bound: 99 },
      unit: 'count',
    });
    expect(suppressed.status).toBe('suppressed');
    expect(getNumericEstimateValue(suppressed)).toBeUndefined();
    expect((suppressed as Record<string, unknown>).value).toBeUndefined();

    const unavailable = EconomicEstimateSchema.parse({
      status: 'unavailable',
      reason: 'Survey not conducted for requested geography',
      expected_availability: '2027-05-01T00:00:00.000Z',
    });
    expect(unavailable.status).toBe('unavailable');
    expect(getNumericEstimateValue(unavailable)).toBeUndefined();
    expect((unavailable as Record<string, unknown>).value).toBeUndefined();

    const notApplicable = EconomicEstimateSchema.parse({
      status: 'not_applicable',
      reason: 'Metric applies only to coastal tracts',
    });
    expect(notApplicable.status).toBe('not_applicable');
    expect(getNumericEstimateValue(notApplicable)).toBeUndefined();
    expect((notApplicable as Record<string, unknown>).value).toBeUndefined();
  });

  it('strictly forbids coercing suppressed or unavailable estimates to zero', () => {
    const suppressed = EconomicEstimateSchema.parse({
      status: 'suppressed',
      reason: 'small_sample',
      detail: 'Sample size below threshold',
    });
    const unavailable = EconomicEstimateSchema.parse({
      status: 'unavailable',
      reason: 'Feed unavailable',
    });
    const notApplicable = EconomicEstimateSchema.parse({
      status: 'not_applicable',
      reason: 'N/A',
    });

    expect(getNumericEstimateValue(suppressed)).not.toBe(0);
    expect(getNumericEstimateValue(unavailable)).not.toBe(0);
    expect(getNumericEstimateValue(notApplicable)).not.toBe(0);
    expect(getNumericEstimateValue(suppressed)).toBeUndefined();
    expect(getNumericEstimateValue(unavailable)).toBeUndefined();
    expect(getNumericEstimateValue(notApplicable)).toBeUndefined();
  });
});

describe('Evidence Disagreement & Evidence Bundles', () => {
  it('validates prediction vs observation disagreement state with linkable signals', () => {
    const disagreement = EconomicDisagreementSchema.parse({
      status: 'disagreement',
      expected: {
        source_metric: 'model.expected_employment',
        description: 'Prior econometric projection model',
        estimate: {
          status: 'available',
          value: 450,
          margin_of_error: 25,
          confidence_level: 0.95,
          sample_size: 300,
          unit: 'count',
        },
      },
      observed: {
        source_metric: 'cbp.observed_employment',
        description: 'Latest County Business Patterns direct count',
        estimate: {
          status: 'available',
          value: 120,
          margin_of_error: null,
          confidence_level: null,
          sample_size: null,
          unit: 'count',
        },
      },
      delta_description: 'Observed employment is 73% lower than projected econometric trend',
      severity: 'warning',
    });
    expect(disagreement.status).toBe('disagreement');
    expect(disagreement.severity).toBe('warning');
  });

  it('validates evidence record and evidence bundle', () => {
    const record = EconomicEvidenceRecordSchema.parse({
      evidence_id: 'ev-acs-income-06075-2025',
      source_id: 'census-acs',
      metric_id: 'median-household-income',
      variable_name: 'B19013_001E',
      label: 'Median Household Income in San Francisco County',
      geography: {
        level: 'county',
        county_fips: '06075',
        state_fips: '06',
        name: 'San Francisco County',
      },
      estimate: {
        status: 'available',
        value: 136689,
        margin_of_error: 3412,
        confidence_level: 0.9,
        sample_size: 4200,
        unit: 'USD',
      },
      provenance: mockProvenance,
      tags: ['income', 'demographics', 'census'],
    });
    expect(record.evidence_id).toBe('ev-acs-income-06075-2025');

    const bundle = EconomicEvidenceBundleSchema.parse({
      bundle_id: 'bundle-sf-economic-profile-2026',
      tenant_id: 'tenant-enterprise-alpha',
      title: 'San Francisco Economic Baseline Profile',
      target_geography: { level: 'county', county_fips: '06075' },
      records: [record],
      created_at: '2026-09-16T12:05:00.000Z',
      provenance: mockProvenance,
    });
    expect(bundle.bundle_id).toBe('bundle-sf-economic-profile-2026');
    expect(bundle.records.length).toBe(1);
  });
});

describe('BusinessContext input & preview contracts', () => {
  const validInput = {
    business_name: 'Acme Precision Manufacturing, LLC',
    naics_code: '332710',
    industry_title: 'Machine Shops',
    target_geography: { level: 'county', county_fips: '06075' },
    operating_radius_meters: 25000,
    employee_count_estimate: 45,
    annual_revenue_usd_estimate: 8500000,
  } as const;

  it('validates business context input and preview with mandatory legal disclaimer', () => {
    expect(BusinessContextInputSchema.parse(validInput).naics_code).toBe('332710');

    const preview = BusinessContextPreviewSchema.parse({
      schema_version: ECONOMIC_SCHEMA_VERSION,
      preview_id: 'prev-acme-mfg-001',
      tenant_id: 'tenant-mfg-corp',
      generated_at: '2026-09-16T12:10:00.000Z',
      input: validInput,
      evidence: [],
      summary_estimates: {
        median_market_wage: {
          status: 'available',
          value: 78500,
          margin_of_error: 2100,
          confidence_level: 0.9,
          sample_size: 450,
          unit: 'USD',
        },
        local_competitor_density: {
          status: 'suppressed',
          reason: 'disclosure_avoidance',
          detail: 'Microdata count suppressed',
        },
      },
      provenance: mockProvenance,
      warnings: ['Suppressed microdata in 1 county block group.'],
      disclaimer: ECONOMIC_LEGAL_DISCLAIMER,
    });

    expect(preview.disclaimer).toBe(ECONOMIC_LEGAL_DISCLAIMER);
    expect(preview.schema_version).toBe(1);
  });
});
