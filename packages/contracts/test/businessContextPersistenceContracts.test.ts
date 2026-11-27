import {
  BUSINESS_CONTEXT_LIMITS,
  BusinessContextCreateRequestSchema,
  BusinessContextDeletionReceiptSchema,
  BusinessContextUpdateRequestSchema,
  assertSafeStructuredValue,
  parseBoundedJsonPayload,
} from '@gev/contracts';
import { describe, expect, it } from 'vitest';

const SAMPLE_INPUT = {
  business_name: 'Austin Precision Roasters LLC',
  naics_code: '722515',
  industry_title: 'Snack and Nonalcoholic Beverage Bars',
  target_geography: {
    level: 'county' as const,
    county_fips: '48453',
    state_fips: '48',
    name: 'Travis County, TX',
  },
  operating_radius_meters: 5000,
  employee_count_estimate: 14,
  annual_revenue_usd_estimate: 1_250_000,
};

describe('Task 13.1 BusinessContext persistence contracts', () => {
  it('validates create, update, and deletion receipt schemas', () => {
    const createReq = BusinessContextCreateRequestSchema.parse({
      context_id: 'roasters-hq-01',
      input: SAMPLE_INPUT,
      retention_days: 180,
      legal_hold: false,
      change_reason: 'Initial site intake',
    });
    expect(createReq.context_id).toBe('roasters-hq-01');

    const updateReq = BusinessContextUpdateRequestSchema.parse({
      expected_version: 1,
      input: { ...SAMPLE_INPUT, employee_count_estimate: 18 },
      change_reason: 'Q4 staffing revision',
    });
    expect(updateReq.expected_version).toBe(1);

    const receipt = BusinessContextDeletionReceiptSchema.parse({
      format_version: 'gev.business_context.deletion.v1',
      receipt_id: '550e8400-e29b-41d4-a716-446655440000',
      tenant_id: 'tenant-alpha',
      context_id: 'roasters-hq-01',
      deleted_at: '2026-11-27T12:00:00.000Z',
      deleted_by: 'admin-1',
      versions_purged: 2,
      verified_zero_remaining: true,
      audit_intent_id: 'intent-123',
    });
    expect(receipt.verified_zero_remaining).toBe(true);
  });

  it('rejects prototype-pollution keys, excessive nesting depth, and oversized payloads', () => {
    expect(() => parseBoundedJsonPayload('{"__proto__":{"polluted":true}}')).toThrow(
      /Forbidden prototype key/
    );
    expect(() => parseBoundedJsonPayload('{"nested":{"constructor":{"x":1}}}')).toThrow(
      /Forbidden prototype key/
    );

    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < BUSINESS_CONTEXT_LIMITS.maxDepth + 2; i += 1) {
      deep = { child: deep };
    }
    expect(() => assertSafeStructuredValue(deep)).toThrow(/nesting depth exceeded/i);

    const oversized = JSON.stringify({ pad: 'a'.repeat(BUSINESS_CONTEXT_LIMITS.maxPayloadBytes) });
    expect(() => parseBoundedJsonPayload(oversized)).toThrow(/exceeds maximum bound/i);
  });

  it('rejects out-of-bounds retention days and unknown fields', () => {
    expect(
      BusinessContextCreateRequestSchema.safeParse({
        input: SAMPLE_INPUT,
        retention_days: 0,
      }).success
    ).toBe(false);
    expect(
      BusinessContextCreateRequestSchema.safeParse({
        input: SAMPLE_INPUT,
        retention_days: 4000,
      }).success
    ).toBe(false);
    expect(
      BusinessContextCreateRequestSchema.safeParse({
        input: SAMPLE_INPUT,
        unexpected_field: true,
      }).success
    ).toBe(false);
  });
});
