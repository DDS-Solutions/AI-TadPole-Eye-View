import crypto from 'node:crypto';
import {
  type Actor,
  BUSINESS_CONTEXT_LIMITS,
  BUSINESS_CONTEXT_PERSISTENCE_SCHEMA_VERSION,
  type BusinessContextInput,
  BusinessContextInputSchema,
  type BusinessContextMetadata,
  BusinessContextMetadataSchema,
  assertSafeStructuredValue,
} from '@gev/contracts';
import { canonicalizeJson } from './canonicalJson.js';
import { decryptSecret, encryptSecret } from './layerAccessCrypto.js';

export type BusinessContextStoreErrorCode =
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'VERSION_CONFLICT'
  | 'LEGAL_HOLD_ACTIVE'
  | 'INTEGRITY_ERROR'
  | 'TENANT_MISMATCH'
  | 'INVALID_INPUT';

export class BusinessContextStoreError extends Error {
  constructor(
    readonly code: BusinessContextStoreErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'BusinessContextStoreError';
  }
}

export interface ContextRow {
  tenant_id: string;
  context_id: string;
  current_version: number;
  encryption_key_id: string;
  retention_days: number;
  expires_at: string;
  legal_hold: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
}

export interface VersionRow {
  tenant_id: string;
  context_id: string;
  version: number;
  encrypted_payload: string;
  payload_sha256: string;
  encryption_key_id: string;
  created_at: string;
  created_by: string;
  change_reason: string | null;
}

export function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

export function buildBusinessContextAad(
  tenantId: string,
  contextId: string,
  version: number
): string {
  return `business_context.v1:${tenantId}:${contextId}:v${version}`;
}

export function safeAuditInputSummary(input: BusinessContextInput): Record<string, unknown> {
  return {
    naics_code: input.naics_code,
    geography_level: input.target_geography.level,
    has_operating_radius: input.operating_radius_meters !== undefined,
    has_employee_estimate: input.employee_count_estimate !== undefined,
    has_revenue_estimate: input.annual_revenue_usd_estimate !== undefined,
  };
}

export function normalizeAuditActor(actor: Actor | string): Actor {
  return actor === 'human' || actor === 'ai' || actor === 'system' ? actor : 'human';
}

export function encryptBusinessContextInput(
  tenantId: string,
  contextId: string,
  version: number,
  input: BusinessContextInput,
  options: { encryptionKey?: Buffer; encryptionKeyId: string }
): { encryptedPayload: string; payloadSha256: string } {
  assertSafeStructuredValue(input, BUSINESS_CONTEXT_LIMITS.maxDepth);
  const canonical = canonicalizeJson(input);
  const byteLength = Buffer.byteLength(canonical, 'utf8');
  if (byteLength > BUSINESS_CONTEXT_LIMITS.maxPayloadBytes) {
    throw new BusinessContextStoreError(
      'INVALID_INPUT',
      `BusinessContext payload (${byteLength} bytes) exceeds ${BUSINESS_CONTEXT_LIMITS.maxPayloadBytes} byte cap`
    );
  }
  const payloadSha256 = sha256Hex(canonical);
  const encryptedPayload = encryptSecret(canonical, {
    key: options.encryptionKey,
    keyId: options.encryptionKeyId,
    aad: buildBusinessContextAad(tenantId, contextId, version),
  });
  return { encryptedPayload, payloadSha256 };
}

export function decryptAndVerifyBusinessContextVersion(
  row: VersionRow,
  encryptionKey?: Buffer
): BusinessContextInput {
  let plaintext: string;
  try {
    plaintext = decryptSecret(row.encrypted_payload, {
      key: encryptionKey,
      aad: buildBusinessContextAad(row.tenant_id, row.context_id, row.version),
    });
  } catch {
    throw new BusinessContextStoreError(
      'INTEGRITY_ERROR',
      `Failed to decrypt BusinessContext '${row.context_id}' v${row.version}; ciphertext or tenant AAD verification failed`
    );
  }

  const actualHash = sha256Hex(plaintext);
  if (actualHash !== row.payload_sha256) {
    throw new BusinessContextStoreError(
      'INTEGRITY_ERROR',
      `Payload SHA-256 mismatch for BusinessContext '${row.context_id}' v${row.version}`
    );
  }

  try {
    const parsedJson: unknown = JSON.parse(plaintext);
    assertSafeStructuredValue(parsedJson, BUSINESS_CONTEXT_LIMITS.maxDepth);
    return BusinessContextInputSchema.parse(parsedJson);
  } catch {
    throw new BusinessContextStoreError(
      'INTEGRITY_ERROR',
      `Corrupted BusinessContext schema payload for '${row.context_id}' v${row.version}`
    );
  }
}

export function mapBusinessContextMetadata(
  header: ContextRow,
  versionRow: Pick<VersionRow, 'version' | 'payload_sha256' | 'encryption_key_id' | 'change_reason'>
): BusinessContextMetadata {
  return BusinessContextMetadataSchema.parse({
    schema_version: BUSINESS_CONTEXT_PERSISTENCE_SCHEMA_VERSION,
    context_id: header.context_id,
    tenant_id: header.tenant_id,
    version: versionRow.version,
    payload_sha256: versionRow.payload_sha256,
    encryption_algorithm: 'aes-256-gcm',
    encryption_key_id: versionRow.encryption_key_id,
    retention_days: header.retention_days,
    expires_at: header.expires_at,
    legal_hold: header.legal_hold === 1,
    created_at: header.created_at,
    updated_at: header.updated_at,
    created_by: header.created_by,
    updated_by: header.updated_by,
    ...(versionRow.change_reason ? { change_reason: versionRow.change_reason } : {}),
  });
}
