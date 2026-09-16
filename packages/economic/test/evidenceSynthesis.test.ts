import {
  type BusinessContextInput,
  ECONOMIC_LEGAL_DISCLAIMER,
  type EconomicEstimate,
  type EconomicEvidenceRecord,
} from '@gev/contracts';
import { describe, expect, it } from 'vitest';
import {
  evaluateEvidenceDisagreement,
  synthesizeBusinessContextPreview,
} from '../src/evidenceSynthesis.js';

describe('Evidence Synthesis & Disagreement Evaluation', () => {
  describe('evaluateEvidenceDisagreement', () => {
    const baselineEstimate: EconomicEstimate = {
      status: 'available',
      value: 100,
      margin_of_error: 5,
      confidence_level: 0.9,
      sample_size: 1000,
      unit: 'count',
    };

    it('returns null when observed value is within warning threshold (<15%)', () => {
      const observedConsistent: EconomicEstimate = {
        status: 'available',
        value: 108, // 8% delta
        margin_of_error: 5,
        confidence_level: 0.9,
        sample_size: 1000,
        unit: 'count',
      };

      const result = evaluateEvidenceDisagreement(
        'model-projection',
        'Projected establishment count',
        baselineEstimate,
        'census-cbp',
        'Observed establishment count',
        observedConsistent
      );

      expect(result).toBeNull();
    });

    it('detects warning disagreement when delta is between 15% and 35%', () => {
      const observedModerate: EconomicEstimate = {
        status: 'available',
        value: 125, // 25% higher
        margin_of_error: 5,
        confidence_level: 0.9,
        sample_size: 1000,
        unit: 'count',
      };

      const result = evaluateEvidenceDisagreement(
        'model-projection',
        'Projected establishment count',
        baselineEstimate,
        'census-cbp',
        'Observed establishment count',
        observedModerate
      );

      expect(result).not.toBeNull();
      expect(result?.status).toBe('disagreement');
      expect(result?.severity).toBe('warning');
      expect(result?.delta_description).toContain('25% higher');
    });

    it('detects critical disagreement when delta exceeds 35%', () => {
      const observedDivergent: EconomicEstimate = {
        status: 'available',
        value: 50, // 50% lower
        margin_of_error: 5,
        confidence_level: 0.9,
        sample_size: 1000,
        unit: 'count',
      };

      const result = evaluateEvidenceDisagreement(
        'model-projection',
        'Projected establishment count',
        baselineEstimate,
        'census-cbp',
        'Observed establishment count',
        observedDivergent
      );

      expect(result).not.toBeNull();
      expect(result?.status).toBe('disagreement');
      expect(result?.severity).toBe('critical');
      expect(result?.delta_description).toContain('50% lower');
    });

    it('detects status disparity when one source is suppressed and other available', () => {
      const suppressedEstimate: EconomicEstimate = {
        status: 'suppressed',
        reason: 'disclosure_avoidance',
        detail: 'Fewer than 3 establishments in sector',
      };

      const result = evaluateEvidenceDisagreement(
        'model-projection',
        'Projected establishment count',
        baselineEstimate,
        'census-cbp',
        'Observed establishment count',
        suppressedEstimate
      );

      expect(result).not.toBeNull();
      expect(result?.severity).toBe('info');
      expect(result?.delta_description).toContain(
        'Status disparity: expected available, observed suppressed'
      );
    });
  });

  describe('synthesizeBusinessContextPreview', () => {
    const testInput: BusinessContextInput = {
      business_name: 'Apex Precision Tools',
      naics_code: '332216',
      industry_title: 'Saw Blade and Handtool Manufacturing',
      target_geography: {
        level: 'county',
        county_fips: '06075',
        state_fips: '06',
        name: 'San Francisco County',
      },
    };

    const mockEvidenceRecord: EconomicEvidenceRecord = {
      evidence_id: 'ev-cbp-establishments',
      source_id: 'census-cbp-zbp',
      metric_id: 'total-establishments',
      variable_name: 'ESTAB',
      label: 'Total NAICS 332216 Establishments',
      geography: testInput.target_geography,
      estimate: {
        status: 'available',
        value: 12,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'establishments',
      },
      provenance: {
        schema_version: 1,
        source_id: 'census-cbp-zbp',
        canonical_source_url: 'https://www.census.gov/programs-surveys/cbp.html',
        retrieval_timestamp_ms: 1726480000000,
        observation_period: '2023',
        mode: 'seed',
        license_id: 'us-government-public-domain',
        attribution: 'U.S. Census Bureau CBP',
      },
    };

    it('synthesizes compliant preview preserving mandatory legal disclaimer', () => {
      const preview = synthesizeBusinessContextPreview({
        previewId: 'prev-test-01',
        tenantId: 'tenant-demo',
        isoTimestamp: '2026-09-16T12:00:00Z',
        input: testInput,
        evidence: [mockEvidenceRecord],
        summaryEstimates: {
          total_market_size: {
            status: 'available',
            value: 45000000,
            margin_of_error: 2500000,
            confidence_level: 0.9,
            sample_size: 150,
            unit: 'USD',
          },
        },
      });

      expect(preview.preview_id).toBe('prev-test-01');
      expect(preview.disclaimer).toBe(ECONOMIC_LEGAL_DISCLAIMER);
      expect(preview.evidence.length).toBe(1);
      expect(preview.summary_estimates.total_market_size.status).toBe('available');
    });

    it('never coerces suppressed metrics to zero and logs transparent warning', () => {
      const preview = synthesizeBusinessContextPreview({
        previewId: 'prev-suppressed-01',
        tenantId: 'tenant-demo',
        isoTimestamp: '2026-09-16T12:00:00Z',
        input: testInput,
        evidence: [mockEvidenceRecord],
        summaryEstimates: {
          payroll_total: {
            status: 'suppressed',
            reason: 'disclosure_avoidance',
            detail: 'Withheld to avoid disclosing data for individual companies',
          },
        },
      });

      expect(preview.summary_estimates.payroll_total.status).toBe('suppressed');
      expect('value' in preview.summary_estimates.payroll_total).toBe(false);
      expect(
        preview.warnings.some((w) => w.includes('payroll_total') && w.includes('suppressed'))
      ).toBe(true);
    });
  });
});
