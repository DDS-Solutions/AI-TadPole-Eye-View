import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  BUSINESS_CONTEXT_BACKUP_FORMAT_VERSION,
  BUSINESS_CONTEXT_DELETION_RECEIPT_VERSION,
  BUSINESS_CONTEXT_EXPORT_FORMAT_VERSION,
  BUSINESS_CONTEXT_LIMITS,
  BUSINESS_CONTEXT_PERSISTENCE_SCHEMA_VERSION,
  type BusinessContextDeletionReceipt,
  BusinessContextDeletionReceiptSchema,
  type BusinessContextEncryptedBackup,
  BusinessContextEncryptedBackupSchema,
  type BusinessContextExportBundle,
  BusinessContextExportBundleSchema,
  type BusinessContextMetadata,
  BusinessContextMetadataSchema,
  type BusinessContextVersionSummary,
  type PersistedBusinessContext,
  PersistedBusinessContextSchema,
  assertSafeStructuredValue,
} from '@gev/contracts';
import type { SimClock } from '@gev/core';
import {
  BusinessContextStoreError,
  type ContextRow,
  type VersionRow,
  decryptAndVerifyBusinessContextVersion,
  mapBusinessContextMetadata,
  sha256Hex,
} from './businessContextCrypto.js';
import { canonicalizeJson } from './canonicalJson.js';
import { withImmediateTransaction } from './governanceDb.js';

export function buildBusinessContextExport(
  db: DatabaseSync,
  clock: SimClock,
  tenantId: string,
  contextId: string,
  actorId: string,
  context: PersistedBusinessContext
): BusinessContextExportBundle {
  const versionRows = db
    .prepare(
      `SELECT version, payload_sha256, encryption_key_id, created_at, created_by, change_reason
       FROM governance_business_context_versions
       WHERE tenant_id = ? AND context_id = ?
       ORDER BY version ASC`
    )
    .all(tenantId, contextId) as unknown as Array<
    Omit<VersionRow, 'tenant_id' | 'context_id' | 'encrypted_payload'>
  >;

  const versionHistory: BusinessContextVersionSummary[] = versionRows.map((v) => ({
    version: v.version,
    payload_sha256: v.payload_sha256,
    encryption_key_id: v.encryption_key_id,
    created_at: v.created_at,
    created_by: v.created_by,
    ...(v.change_reason ? { change_reason: v.change_reason } : {}),
  }));

  const unsigned = {
    format_version: BUSINESS_CONTEXT_EXPORT_FORMAT_VERSION,
    exported_at: new Date(clock.now()).toISOString(),
    tenant_id: tenantId,
    exported_by: actorId,
    context,
    version_history: versionHistory,
  };
  return BusinessContextExportBundleSchema.parse({
    ...unsigned,
    bundle_sha256: sha256Hex(canonicalizeJson(unsigned)),
  });
}

export function buildBusinessContextEncryptedBackup(
  db: DatabaseSync,
  clock: SimClock,
  tenantId: string,
  contextId: string
): BusinessContextEncryptedBackup {
  const header = db
    .prepare('SELECT * FROM governance_business_contexts WHERE tenant_id = ? AND context_id = ?')
    .get(tenantId, contextId) as ContextRow | undefined;
  if (!header) {
    throw new BusinessContextStoreError('NOT_FOUND', `BusinessContext '${contextId}' not found`);
  }
  const versions = db
    .prepare(
      `SELECT * FROM governance_business_context_versions
       WHERE tenant_id = ? AND context_id = ?
       ORDER BY version ASC`
    )
    .all(tenantId, contextId) as unknown as VersionRow[];

  const unsigned = {
    format_version: BUSINESS_CONTEXT_BACKUP_FORMAT_VERSION,
    backed_up_at: new Date(clock.now()).toISOString(),
    tenant_id: tenantId,
    context_id: contextId,
    current_version: header.current_version,
    encryption_algorithm: 'aes-256-gcm' as const,
    encryption_key_id: header.encryption_key_id,
    retention_days: header.retention_days,
    expires_at: header.expires_at,
    legal_hold: header.legal_hold === 1,
    created_at: header.created_at,
    updated_at: header.updated_at,
    created_by: header.created_by,
    updated_by: header.updated_by,
    encrypted_versions: versions.map((v) => ({
      version: v.version,
      encrypted_payload: v.encrypted_payload,
      payload_sha256: v.payload_sha256,
      encryption_key_id: v.encryption_key_id,
      created_at: v.created_at,
      created_by: v.created_by,
      ...(v.change_reason ? { change_reason: v.change_reason } : {}),
    })),
  };
  return BusinessContextEncryptedBackupSchema.parse({
    ...unsigned,
    backup_sha256: sha256Hex(canonicalizeJson(unsigned)),
  });
}

export function verifyAndRestoreBusinessContextBackup(
  db: DatabaseSync,
  tenantId: string,
  backup: BusinessContextEncryptedBackup,
  encryptionKey?: Buffer
): BusinessContextMetadata {
  assertSafeStructuredValue(backup, BUSINESS_CONTEXT_LIMITS.maxDepth);
  const parsed = BusinessContextEncryptedBackupSchema.parse(backup);
  if (parsed.tenant_id !== tenantId) {
    throw new BusinessContextStoreError(
      'TENANT_MISMATCH',
      'Encrypted backup belongs to a different tenant; cross-tenant restore denied'
    );
  }
  const { backup_sha256, ...unsigned } = parsed;
  if (sha256Hex(canonicalizeJson(unsigned)) !== backup_sha256) {
    throw new BusinessContextStoreError(
      'INTEGRITY_ERROR',
      'Encrypted backup SHA-256 verification failed'
    );
  }

  for (const v of parsed.encrypted_versions) {
    decryptAndVerifyBusinessContextVersion(
      {
        tenant_id: tenantId,
        context_id: parsed.context_id,
        version: v.version,
        encrypted_payload: v.encrypted_payload,
        payload_sha256: v.payload_sha256,
        encryption_key_id: v.encryption_key_id,
        created_at: v.created_at,
        created_by: v.created_by,
        change_reason: v.change_reason ?? null,
      },
      encryptionKey
    );
  }

  return withImmediateTransaction(db, () => {
    const existing = db
      .prepare(
        'SELECT context_id FROM governance_business_contexts WHERE tenant_id = ? AND context_id = ?'
      )
      .get(tenantId, parsed.context_id);
    if (existing) {
      throw new BusinessContextStoreError(
        'ALREADY_EXISTS',
        `Refusing to overwrite existing BusinessContext '${parsed.context_id}' during restore`
      );
    }

    db.prepare(
      `INSERT INTO governance_business_contexts (
        tenant_id, context_id, current_version, encryption_key_id,
        retention_days, expires_at, legal_hold,
        created_at, updated_at, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      tenantId,
      parsed.context_id,
      parsed.current_version,
      parsed.encryption_key_id,
      parsed.retention_days,
      parsed.expires_at,
      parsed.legal_hold ? 1 : 0,
      parsed.created_at,
      parsed.updated_at,
      parsed.created_by,
      parsed.updated_by
    );

    const insertVer = db.prepare(
      `INSERT INTO governance_business_context_versions (
        tenant_id, context_id, version, encrypted_payload,
        payload_sha256, encryption_key_id, created_at, created_by, change_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const v of parsed.encrypted_versions) {
      insertVer.run(
        tenantId,
        parsed.context_id,
        v.version,
        v.encrypted_payload,
        v.payload_sha256,
        v.encryption_key_id,
        v.created_at,
        v.created_by,
        v.change_reason ?? null
      );
    }

    const latest = parsed.encrypted_versions[parsed.encrypted_versions.length - 1];
    if (!latest) {
      throw new BusinessContextStoreError('INTEGRITY_ERROR', 'Backup contains no versions');
    }
    return BusinessContextMetadataSchema.parse({
      schema_version: BUSINESS_CONTEXT_PERSISTENCE_SCHEMA_VERSION,
      context_id: parsed.context_id,
      tenant_id: tenantId,
      version: latest.version,
      payload_sha256: latest.payload_sha256,
      encryption_algorithm: 'aes-256-gcm',
      encryption_key_id: latest.encryption_key_id,
      retention_days: parsed.retention_days,
      expires_at: parsed.expires_at,
      legal_hold: parsed.legal_hold,
      created_at: parsed.created_at,
      updated_at: parsed.updated_at,
      created_by: parsed.created_by,
      updated_by: parsed.updated_by,
      ...(latest.change_reason ? { change_reason: latest.change_reason } : {}),
    });
  });
}

export function insertBusinessContextVersionRow(
  db: DatabaseSync,
  row: {
    tenantId: string;
    contextId: string;
    version: number;
    encryptedPayload: string;
    payloadSha256: string;
    encryptionKeyId: string;
    createdAt: string;
    createdBy: string;
    changeReason: string | null;
  }
): void {
  db.prepare(
    `INSERT INTO governance_business_context_versions (
      tenant_id, context_id, version, encrypted_payload,
      payload_sha256, encryption_key_id, created_at, created_by, change_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.tenantId,
    row.contextId,
    row.version,
    row.encryptedPayload,
    row.payloadSha256,
    row.encryptionKeyId,
    row.createdAt,
    row.createdBy,
    row.changeReason
  );
}

export function readPersistedBusinessContext(
  db: DatabaseSync,
  tenantId: string,
  contextId: string,
  version: number | undefined,
  encryptionKey?: Buffer
): PersistedBusinessContext | null {
  const header = db
    .prepare('SELECT * FROM governance_business_contexts WHERE tenant_id = ? AND context_id = ?')
    .get(tenantId, contextId) as ContextRow | undefined;
  if (!header) {
    return null;
  }
  const targetVersion = version ?? header.current_version;
  const versionRow = db
    .prepare(
      `SELECT * FROM governance_business_context_versions
       WHERE tenant_id = ? AND context_id = ? AND version = ?`
    )
    .get(tenantId, contextId, targetVersion) as VersionRow | undefined;
  if (!versionRow) {
    return null;
  }
  const input = decryptAndVerifyBusinessContextVersion(versionRow, encryptionKey);
  return PersistedBusinessContextSchema.parse({
    ...mapBusinessContextMetadata(header, versionRow),
    input,
  });
}

export function listTenantBusinessContexts(
  db: DatabaseSync,
  tenantId: string
): BusinessContextMetadata[] {
  const rows = db
    .prepare(
      `SELECT c.*, v.version, v.payload_sha256, v.encryption_key_id AS v_key_id, v.change_reason
       FROM governance_business_contexts c
       JOIN governance_business_context_versions v
         ON v.tenant_id = c.tenant_id
        AND v.context_id = c.context_id
        AND v.version = c.current_version
       WHERE c.tenant_id = ?
       ORDER BY c.updated_at DESC, c.context_id ASC`
    )
    .all(tenantId) as unknown as Array<
    ContextRow & {
      version: number;
      payload_sha256: string;
      v_key_id: string;
      change_reason: string | null;
    }
  >;

  return rows.map((row) =>
    mapBusinessContextMetadata(row, {
      version: row.version,
      payload_sha256: row.payload_sha256,
      encryption_key_id: row.v_key_id,
      change_reason: row.change_reason,
    })
  );
}

export function executeVerifiedBusinessContextDelete(
  db: DatabaseSync,
  clock: SimClock,
  tenantId: string,
  contextId: string,
  actorId: string,
  intentId: string,
  forceLegalHold: boolean
): BusinessContextDeletionReceipt {
  return withImmediateTransaction(db, () => {
    const header = db
      .prepare('SELECT * FROM governance_business_contexts WHERE tenant_id = ? AND context_id = ?')
      .get(tenantId, contextId) as ContextRow | undefined;
    if (!header) {
      throw new BusinessContextStoreError('NOT_FOUND', `BusinessContext '${contextId}' not found`);
    }
    if (header.legal_hold === 1 && !forceLegalHold) {
      throw new BusinessContextStoreError(
        'LEGAL_HOLD_ACTIVE',
        `BusinessContext '${contextId}' is protected by legal hold`
      );
    }

    const deletedVersions = Number(
      db
        .prepare(
          'DELETE FROM governance_business_context_versions WHERE tenant_id = ? AND context_id = ?'
        )
        .run(tenantId, contextId).changes
    );
    db.prepare(
      'DELETE FROM governance_business_contexts WHERE tenant_id = ? AND context_id = ?'
    ).run(tenantId, contextId);

    const remainingHeaders = (
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM governance_business_contexts WHERE tenant_id = ? AND context_id = ?'
        )
        .get(tenantId, contextId) as { count: number }
    ).count;
    const remainingVersions = (
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM governance_business_context_versions WHERE tenant_id = ? AND context_id = ?'
        )
        .get(tenantId, contextId) as { count: number }
    ).count;

    if (remainingHeaders !== 0 || remainingVersions !== 0) {
      throw new BusinessContextStoreError(
        'INTEGRITY_ERROR',
        `Verified deletion failed for '${contextId}': remaining headers=${remainingHeaders}, versions=${remainingVersions}`
      );
    }

    return BusinessContextDeletionReceiptSchema.parse({
      format_version: BUSINESS_CONTEXT_DELETION_RECEIPT_VERSION,
      receipt_id: crypto.randomUUID(),
      tenant_id: tenantId,
      context_id: contextId,
      deleted_at: new Date(clock.now()).toISOString(),
      deleted_by: actorId,
      versions_purged: Math.max(1, deletedVersions),
      verified_zero_remaining: true,
      audit_intent_id: intentId,
    });
  });
}

export function findExpiredBusinessContexts(
  db: DatabaseSync,
  nowIso: string,
  tenantId?: string
): Array<{ tenant_id: string; context_id: string }> {
  return (tenantId
    ? db
        .prepare(
          `SELECT tenant_id, context_id FROM governance_business_contexts
             WHERE tenant_id = ? AND legal_hold = 0 AND expires_at <= ?
             ORDER BY expires_at ASC`
        )
        .all(tenantId, nowIso)
    : db
        .prepare(
          `SELECT tenant_id, context_id FROM governance_business_contexts
             WHERE legal_hold = 0 AND expires_at <= ?
             ORDER BY expires_at ASC`
        )
        .all(nowIso)) as unknown as Array<{ tenant_id: string; context_id: string }>;
}
