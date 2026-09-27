import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  FEMA_NFHL_ADVISORY_DISCLAIMER,
  FEMA_NRI_SCREENING_DISCLAIMER,
  FEMA_NRI_VARIABLES_V1,
  FEMA_NRI_VARIABLE_DICTIONARY_V1,
  classifyNfhlFloodRisk,
  lookupFemaNriVariable,
  parseNfhlDepth,
  parseNfhlStaticBfe,
  parseNriRawEstimate,
  parseNriRiskRating,
  validateFemaNriGeography,
} from '../src/index.js';

describe('FEMA NRI & NFHL Dictionary & Domain Logic (PLAN.md §10 Task 11.1 & ADR 0062)', () => {
  it('validates authoritative FEMA NRI dictionary V1 metadata and variables', () => {
    expect(FEMA_NRI_VARIABLE_DICTIONARY_V1.program).toBe('fema_nri');
    expect(FEMA_NRI_VARIABLE_DICTIONARY_V1.screening_disclaimer).toBe(
      FEMA_NRI_SCREENING_DISCLAIMER
    );
    expect(Object.keys(FEMA_NRI_VARIABLES_V1).length).toBeGreaterThanOrEqual(25);

    // Look up composite risk score
    const riskScore = lookupFemaNriVariable('RISK_SCORE');
    expect(riskScore).toBeDefined();
    expect(riskScore?.metric_id).toBe('nri-composite-risk-score');
    expect(riskScore?.unit).toBe('index_score');

    // Look up by metric_id
    const ealTotal = lookupFemaNriVariable('expected-annual-loss-total');
    expect(ealTotal).toBeDefined();
    expect(ealTotal?.variable_id).toBe('EAL_VALT');
    expect(ealTotal?.unit).toBe('USD');

    // Look up specific hazard
    const riverine = lookupFemaNriVariable('RFLD_RISKS');
    expect(riverine?.hazard_type).toBe('riverine_flooding');

    const unknown = lookupFemaNriVariable('NON_EXISTENT_METRIC');
    expect(unknown).toBeUndefined();
  });

  it('validates geographic constraints for FEMA NRI', () => {
    expect(() =>
      validateFemaNriGeography({
        level: 'county',
        county_fips: '48453',
        state_fips: '48',
      })
    ).not.toThrow();

    expect(() =>
      validateFemaNriGeography({
        level: 'tract',
        tract_fips: '48453000101',
        county_fips: '48453',
        state_fips: '48',
      })
    ).not.toThrow();

    expect(() =>
      validateFemaNriGeography({
        level: 'nation',
        country_code: 'US',
      })
    ).toThrow(/FEMA NRI supports geographies: county, tract, state/);
  });

  it('classifies FEMA NFHL flood zones and prevents coercion of Zone D into minimal risk', () => {
    // SFHA / 100-year zones
    expect(classifyNfhlFloodRisk('A')).toBe('high_risk_sfha');
    expect(classifyNfhlFloodRisk('AE')).toBe('high_risk_sfha');
    expect(classifyNfhlFloodRisk('AH')).toBe('high_risk_sfha');
    expect(classifyNfhlFloodRisk('AO')).toBe('high_risk_sfha');
    expect(classifyNfhlFloodRisk('VE')).toBe('high_risk_sfha');
    expect(classifyNfhlFloodRisk('A1-A30')).toBe('high_risk_sfha');

    // 500-year moderate risk
    expect(classifyNfhlFloodRisk('B')).toBe('moderate_risk_500yr');
    expect(classifyNfhlFloodRisk('X', '0.2 PCT ANNUAL CHANCE FLOOD HAZARD')).toBe(
      'moderate_risk_500yr'
    );

    // Minimal risk outside 500-year
    expect(classifyNfhlFloodRisk('C')).toBe('minimal_risk_outside_sfha');
    expect(classifyNfhlFloodRisk('X')).toBe('minimal_risk_outside_sfha');
    expect(classifyNfhlFloodRisk('X', 'AREA OF MINIMAL FLOOD HAZARD')).toBe(
      'minimal_risk_outside_sfha'
    );

    // Crucial: Zone D (undetermined risk) MUST NOT be classified as minimal risk!
    expect(classifyNfhlFloodRisk('D')).toBe('undetermined_risk_zone_d');
    expect(classifyNfhlFloodRisk('D')).not.toBe('minimal_risk_outside_sfha');

    // Unknown zone
    expect(classifyNfhlFloodRisk('ZZZ')).toBe('unknown');
  });

  it('parses qualitative risk ratings correctly', () => {
    expect(parseNriRiskRating('Very Low')).toBe('Very Low');
    expect(parseNriRiskRating('relatively low')).toBe('Relatively Low');
    expect(parseNriRiskRating('Relatively Moderate')).toBe('Relatively Moderate');
    expect(parseNriRiskRating('RELATIVELY HIGH')).toBe('Relatively High');
    expect(parseNriRiskRating('Very High')).toBe('Very High');
    expect(parseNriRiskRating('Insufficient Data')).toBe('Insufficient Data');
    expect(parseNriRiskRating(null)).toBe('Not Applicable');
    expect(parseNriRiskRating('Unrecognized')).toBe('Not Applicable');
  });

  it('proves zero numeric zero-coercion when parsing FEMA NRI raw estimates', () => {
    // Valid numeric value
    const available = parseNriRawEstimate('24.8', 'index_score', 'Moderate risk');
    expect(available.status).toBe('available');
    if (available.status === 'available') {
      expect(available.value).toBe(24.8);
      expect(available.unit).toBe('index_score');
      expect(available.notes).toBe('Moderate risk');
    }

    // Not applicable cases (must NOT be coerced to 0)
    const notAppStr = parseNriRawEstimate('N/A', 'index_score');
    expect(notAppStr.status).toBe('not_applicable');
    expect((notAppStr as { value?: unknown }).value).toBeUndefined();

    const notAppSentinel = parseNriRawEstimate('-9999', 'USD');
    expect(notAppSentinel.status).toBe('not_applicable');

    // Withheld / suppressed cases
    const suppressed = parseNriRawEstimate('Insufficient Data', 'index_score');
    expect(suppressed.status).toBe('suppressed');
    if (suppressed.status === 'suppressed') {
      expect(suppressed.reason).toBe('data_quality');
      expect(suppressed.unit).toBe('index_score');
    }

    // Missing / null cases
    const missing = parseNriRawEstimate(null, 'USD');
    expect(missing.status).toBe('unavailable');
  });

  it('proves zero numeric zero-coercion when parsing FEMA NFHL Base Flood Elevation and Depth', () => {
    // Valid BFE
    const validBfe = parseNfhlStaticBfe(482.5, 'NAVD88');
    expect(validBfe.status).toBe('available');
    if (validBfe.status === 'available') {
      expect(validBfe.value).toBe(482.5);
      expect(validBfe.unit).toBe('feet');
      expect(validBfe.notes).toBe('Vertical Datum: NAVD88');
    }

    // Absent BFE in unstudied or minimal flood area (must NOT be coerced to 0.0 elevation)
    const absentBfe = parseNfhlStaticBfe(null);
    expect(absentBfe.status).toBe('not_applicable');
    expect((absentBfe as { value?: unknown }).value).toBeUndefined();

    const sentinelBfe = parseNfhlStaticBfe(-9999);
    expect(sentinelBfe.status).toBe('not_applicable');

    // Valid depth in AO zone
    const validDepth = parseNfhlDepth(3.0);
    expect(validDepth.status).toBe('available');
    if (validDepth.status === 'available') {
      expect(validDepth.value).toBe(3.0);
    }

    // Absent depth outside AO zone (must NOT be coerced to 0)
    const absentDepth = parseNfhlDepth(null);
    expect(absentDepth.status).toBe('not_applicable');
  });

  it('property test: arbitrary string inputs to classifyNfhlFloodRisk never throw and map deterministically', () => {
    fc.assert(
      fc.property(fc.string(), fc.option(fc.string()), (zone, subtype) => {
        const result = classifyNfhlFloodRisk(zone, subtype);
        expect([
          'high_risk_sfha',
          'moderate_risk_500yr',
          'minimal_risk_outside_sfha',
          'undetermined_risk_zone_d',
          'unknown',
        ]).toContain(result);
      }),
      { numRuns: 200 }
    );
  });

  it('property test: non-coercing parseNfhlStaticBfe preserves not_applicable invariants', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.constant(''),
          fc.constant(-9999),
          fc.constant('-9999')
        ),
        (raw) => {
          const res = parseNfhlStaticBfe(raw);
          expect(res.status).toBe('not_applicable');
          expect((res as { value?: unknown }).value).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});
