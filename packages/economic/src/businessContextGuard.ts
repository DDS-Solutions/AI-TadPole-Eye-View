import {
  BUSINESS_CONTEXT_LIMITS,
  type BusinessContextInput,
  BusinessContextInputSchema,
  assertSafeStructuredValue,
} from '@gev/contracts';

const MS_PER_DAY = 86_400_000;

export interface RedactedBusinessContextAuditSummary {
  naics_code: string;
  geography_level: BusinessContextInput['target_geography']['level'];
  has_operating_radius: boolean;
  has_employee_estimate: boolean;
  has_revenue_estimate: boolean;
}

/**
 * Computes an explicit retention expiry ISO timestamp from injected SimClock time.
 */
export function computeBusinessContextRetentionExpiry(
  nowMs: number,
  retentionDays: number = BUSINESS_CONTEXT_LIMITS.defaultRetentionDays
): string {
  if (
    !Number.isInteger(retentionDays) ||
    retentionDays < BUSINESS_CONTEXT_LIMITS.minRetentionDays ||
    retentionDays > BUSINESS_CONTEXT_LIMITS.maxRetentionDays
  ) {
    throw new RangeError(
      `retention_days must be an integer between ${BUSINESS_CONTEXT_LIMITS.minRetentionDays} and ${BUSINESS_CONTEXT_LIMITS.maxRetentionDays}`
    );
  }
  return new Date(nowMs + retentionDays * MS_PER_DAY).toISOString();
}

/**
 * Determines whether a persisted BusinessContext is eligible for automated retention purge.
 * Records under legal_hold are never eligible for automated expiry purge.
 */
export function isBusinessContextRetentionExpired(
  expiresAtIso: string,
  nowMs: number,
  legalHold: boolean
): boolean {
  if (legalHold) {
    return false;
  }
  const expiresMs = Date.parse(expiresAtIso);
  if (!Number.isFinite(expiresMs)) {
    return false;
  }
  return expiresMs <= nowMs;
}

/**
 * Validates BusinessContext input against structural depth/prototype guards and byte caps.
 */
export function validateSafeBusinessContextInput(candidate: unknown): BusinessContextInput {
  assertSafeStructuredValue(candidate, BUSINESS_CONTEXT_LIMITS.maxDepth);
  const parsed = BusinessContextInputSchema.parse(candidate);
  const encodedBytes = new TextEncoder().encode(JSON.stringify(parsed)).byteLength;
  if (encodedBytes > BUSINESS_CONTEXT_LIMITS.maxPayloadBytes) {
    throw new Error(
      `BusinessContext payload size (${encodedBytes} bytes) exceeds ${BUSINESS_CONTEXT_LIMITS.maxPayloadBytes} byte cap`
    );
  }
  return parsed;
}

/**
 * Produces a non-sensitive audit summary for M1 audit WAL entries.
 * Never logs tenant business_name, revenue estimates, or employee counts.
 */
export function redactBusinessContextForAudit(
  input: BusinessContextInput
): RedactedBusinessContextAuditSummary {
  return {
    naics_code: input.naics_code,
    geography_level: input.target_geography.level,
    has_operating_radius: input.operating_radius_meters !== undefined,
    has_employee_estimate: input.employee_count_estimate !== undefined,
    has_revenue_estimate: input.annual_revenue_usd_estimate !== undefined,
  };
}
