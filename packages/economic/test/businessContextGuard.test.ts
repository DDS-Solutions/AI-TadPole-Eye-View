import {
  computeBusinessContextRetentionExpiry,
  isBusinessContextRetentionExpired,
  redactBusinessContextForAudit,
  validateSafeBusinessContextInput,
} from '@gev/economic';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

describe('Task 13.1 BusinessContext pure guards and audit redaction', () => {
  it('never leaks sensitive business_name, revenue, or employee counts in audit summaries (property test)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 5, maxLength: 60 }).filter((s) => !/^[0-9]+$/.test(s.trim())),
        fc.integer({ min: 10, max: 50_000 }),
        fc.integer({ min: 50_000, max: 50_000_000 }),
        (businessName, employees, revenue) => {
          const input = validateSafeBusinessContextInput({
            business_name: businessName,
            naics_code: '722515',
            industry_title: 'Specialty Coffee',
            target_geography: { level: 'county', county_fips: '48453' },
            employee_count_estimate: employees,
            annual_revenue_usd_estimate: revenue,
          });
          const summary = redactBusinessContextForAudit(input);
          const serialized = JSON.stringify(summary);
          expect(serialized).not.toContain(businessName);
          expect(serialized).not.toContain(String(revenue));
          expect(summary.naics_code).toBe('722515');
          expect(summary.has_revenue_estimate).toBe(true);
          expect(summary.has_employee_estimate).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('enforces retention expiry timestamps and respects legal hold', () => {
    const baseMs = Date.parse('2026-11-27T00:00:00.000Z');
    const expiry = computeBusinessContextRetentionExpiry(baseMs, 30);
    expect(expiry).toBe('2026-12-27T00:00:00.000Z');
    expect(isBusinessContextRetentionExpired(expiry, baseMs + 29 * 86_400_000, false)).toBe(false);
    expect(isBusinessContextRetentionExpired(expiry, baseMs + 30 * 86_400_000, false)).toBe(true);
    expect(isBusinessContextRetentionExpired(expiry, baseMs + 90 * 86_400_000, true)).toBe(false);
    expect(() => computeBusinessContextRetentionExpiry(baseMs, 0)).toThrow(RangeError);
  });
});
