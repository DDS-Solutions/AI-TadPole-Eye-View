import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  type Actor,
  BUSINESS_CONTEXT_LIMITS,
  BUSINESS_CONTEXT_PERSISTENCE_SCHEMA_VERSION,
  type BusinessContextCreateRequest,
  BusinessContextCreateRequestSchema,
  type BusinessContextDeletionReceipt,
  type BusinessContextEncryptedBackup,
  type BusinessContextExportBundle,
  BusinessContextIdSchema,
  type BusinessContextMetadata,
  type BusinessContextRetentionPurgeResult,
  BusinessContextRetentionPurgeResultSchema,
  type BusinessContextUpdateRequest,
  BusinessContextUpdateRequestSchema,
  GevEvents,
  type PersistedBusinessContext,
  PersistedBusinessContextSchema,
  TenantIdSchema,
  assertSafeStructuredValue,
} from '@gev/contracts';
import type { SimClock } from '@gev/core';
import type { SqliteAuditSink } from './auditSink.js';
import {
  buildBusinessContextEncryptedBackup,
  buildBusinessContextExport,
  executeVerifiedBusinessContextDelete,
  findExpiredBusinessContexts,
  insertBusinessContextVersionRow,
  listTenantBusinessContexts,
  readPersistedBusinessContext,
  verifyAndRestoreBusinessContextBackup,
} from './businessContextBackup.js';
import {
  BusinessContextStoreError,
  type ContextRow,
  encryptBusinessContextInput,
  normalizeAuditActor,
  safeAuditInputSummary,
} from './businessContextCrypto.js';
import { withImmediateTransaction } from './governanceDb.js';

export {
  BusinessContextStoreError,
  type BusinessContextStoreErrorCode,
} from './businessContextCrypto.js';

const MS_PER_DAY = 86_400_000;

export interface SqliteBusinessContextStoreOptions {
  encryptionKey?: Buffer;
  encryptionKeyId?: string;
  auditSink?: SqliteAuditSink;
}

export class SqliteBusinessContextStore {
  private readonly db: DatabaseSync;
  private readonly clock: SimClock;
  private readonly encryptionKey?: Buffer;
  private readonly encryptionKeyId: string;
  private readonly auditSink?: SqliteAuditSink;

  constructor(db: DatabaseSync, clock: SimClock, options: SqliteBusinessContextStoreOptions = {}) {
    this.db = db;
    this.clock = clock;
    this.encryptionKey = options.encryptionKey;
    this.encryptionKeyId = options.encryptionKeyId ?? 'default';
    this.auditSink = options.auditSink;
  }

  private assertTenantId(tenantId: string): string {
    const parsed = TenantIdSchema.safeParse(tenantId);
    if (!parsed.success) {
      throw new BusinessContextStoreError('INVALID_INPUT', 'Invalid tenant identifier');
    }
    return parsed.data;
  }

  private assertContextId(contextId: string): string {
    const parsed = BusinessContextIdSchema.safeParse(contextId);
    if (!parsed.success) {
      throw new BusinessContextStoreError('INVALID_INPUT', 'Invalid BusinessContext identifier');
    }
    return parsed.data;
  }

  private runAudited<T>(
    action: string,
    tenantId: string,
    targetSuffix: string,
    actor: Actor | string,
    taskRef: string,
    params: Record<string, unknown>,
    fn: (intentId: string) => T
  ): T {
    const intentId = crypto.randomUUID();
    const startedAt = this.clock.now();
    this.auditSink?.intent({
      kind: GevEvents.AuditIntent,
      id: intentId,
      ts: new Date(startedAt).toISOString(),
      actor: normalizeAuditActor(actor),
      action,
      target: `tenant:${tenantId}:${targetSuffix}`,
      params,
      task_ref: taskRef,
    });
    try {
      const result = fn(intentId);
      this.auditSink?.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: new Date(this.clock.now()).toISOString(),
        status: 'ok',
        result: { action, target: targetSuffix },
        duration_ms: this.clock.now() - startedAt,
      });
      return result;
    } catch (error) {
      this.auditSink?.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: new Date(this.clock.now()).toISOString(),
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        duration_ms: this.clock.now() - startedAt,
      });
      throw error;
    }
  }

  createContext(
    tenantId: string,
    request: BusinessContextCreateRequest,
    actorId: string,
    taskRef = 'business-context-create'
  ): PersistedBusinessContext {
    const validTenant = this.assertTenantId(tenantId);
    assertSafeStructuredValue(request, BUSINESS_CONTEXT_LIMITS.maxDepth);
    const parsed = BusinessContextCreateRequestSchema.parse(request);
    const contextId = parsed.context_id ?? `ctx-${crypto.randomUUID()}`;
    const retentionDays = parsed.retention_days ?? BUSINESS_CONTEXT_LIMITS.defaultRetentionDays;
    const legalHold = parsed.legal_hold ?? false;

    return this.runAudited(
      'economic.business_context.create',
      validTenant,
      contextId,
      actorId,
      taskRef,
      {
        context_id: contextId,
        retention_days: retentionDays,
        legal_hold: legalHold,
        ...safeAuditInputSummary(parsed.input),
      },
      () =>
        withImmediateTransaction(this.db, () => {
          const existing = this.db
            .prepare(
              'SELECT context_id FROM governance_business_contexts WHERE tenant_id = ? AND context_id = ?'
            )
            .get(validTenant, contextId);
          if (existing) {
            throw new BusinessContextStoreError(
              'ALREADY_EXISTS',
              `BusinessContext '${contextId}' already exists for tenant`
            );
          }

          const nowMs = this.clock.now();
          const nowIso = new Date(nowMs).toISOString();
          const expiresAt = new Date(nowMs + retentionDays * MS_PER_DAY).toISOString();
          const { encryptedPayload, payloadSha256 } = encryptBusinessContextInput(
            validTenant,
            contextId,
            1,
            parsed.input,
            { encryptionKey: this.encryptionKey, encryptionKeyId: this.encryptionKeyId }
          );

          this.db
            .prepare(
              `INSERT INTO governance_business_contexts (
                tenant_id, context_id, current_version, encryption_key_id,
                retention_days, expires_at, legal_hold,
                created_at, updated_at, created_by, updated_by
              ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              validTenant,
              contextId,
              this.encryptionKeyId,
              retentionDays,
              expiresAt,
              legalHold ? 1 : 0,
              nowIso,
              nowIso,
              actorId,
              actorId
            );

          insertBusinessContextVersionRow(this.db, {
            tenantId: validTenant,
            contextId,
            version: 1,
            encryptedPayload,
            payloadSha256,
            encryptionKeyId: this.encryptionKeyId,
            createdAt: nowIso,
            createdBy: actorId,
            changeReason: parsed.change_reason ?? null,
          });

          return PersistedBusinessContextSchema.parse({
            schema_version: BUSINESS_CONTEXT_PERSISTENCE_SCHEMA_VERSION,
            context_id: contextId,
            tenant_id: validTenant,
            version: 1,
            payload_sha256: payloadSha256,
            encryption_algorithm: 'aes-256-gcm',
            encryption_key_id: this.encryptionKeyId,
            retention_days: retentionDays,
            expires_at: expiresAt,
            legal_hold: legalHold,
            created_at: nowIso,
            updated_at: nowIso,
            created_by: actorId,
            updated_by: actorId,
            ...(parsed.change_reason ? { change_reason: parsed.change_reason } : {}),
            input: parsed.input,
          });
        })
    );
  }

  updateContext(
    tenantId: string,
    contextId: string,
    request: BusinessContextUpdateRequest,
    actorId: string,
    taskRef = 'business-context-update'
  ): PersistedBusinessContext {
    const validTenant = this.assertTenantId(tenantId);
    const validContextId = this.assertContextId(contextId);
    assertSafeStructuredValue(request, BUSINESS_CONTEXT_LIMITS.maxDepth);
    const parsed = BusinessContextUpdateRequestSchema.parse(request);

    return this.runAudited(
      'economic.business_context.update',
      validTenant,
      validContextId,
      actorId,
      taskRef,
      {
        context_id: validContextId,
        expected_version: parsed.expected_version,
        ...safeAuditInputSummary(parsed.input),
      },
      () =>
        withImmediateTransaction(this.db, () => {
          const header = this.db
            .prepare(
              'SELECT * FROM governance_business_contexts WHERE tenant_id = ? AND context_id = ?'
            )
            .get(validTenant, validContextId) as ContextRow | undefined;
          if (!header) {
            throw new BusinessContextStoreError(
              'NOT_FOUND',
              `BusinessContext '${validContextId}' not found`
            );
          }
          if (header.current_version !== parsed.expected_version) {
            throw new BusinessContextStoreError(
              'VERSION_CONFLICT',
              `Expected version ${parsed.expected_version}, but current version is ${header.current_version}`
            );
          }

          const nextVersion = header.current_version + 1;
          const nowMs = this.clock.now();
          const nowIso = new Date(nowMs).toISOString();
          const retentionDays = parsed.retention_days ?? header.retention_days;
          const expiresAt =
            parsed.retention_days !== undefined
              ? new Date(nowMs + retentionDays * MS_PER_DAY).toISOString()
              : header.expires_at;
          const legalHold = parsed.legal_hold ?? header.legal_hold === 1;

          const { encryptedPayload, payloadSha256 } = encryptBusinessContextInput(
            validTenant,
            validContextId,
            nextVersion,
            parsed.input,
            { encryptionKey: this.encryptionKey, encryptionKeyId: this.encryptionKeyId }
          );

          this.db
            .prepare(
              `UPDATE governance_business_contexts
               SET current_version = ?, encryption_key_id = ?, retention_days = ?,
                   expires_at = ?, legal_hold = ?, updated_at = ?, updated_by = ?
               WHERE tenant_id = ? AND context_id = ?`
            )
            .run(
              nextVersion,
              this.encryptionKeyId,
              retentionDays,
              expiresAt,
              legalHold ? 1 : 0,
              nowIso,
              actorId,
              validTenant,
              validContextId
            );

          insertBusinessContextVersionRow(this.db, {
            tenantId: validTenant,
            contextId: validContextId,
            version: nextVersion,
            encryptedPayload,
            payloadSha256,
            encryptionKeyId: this.encryptionKeyId,
            createdAt: nowIso,
            createdBy: actorId,
            changeReason: parsed.change_reason ?? null,
          });

          return PersistedBusinessContextSchema.parse({
            schema_version: BUSINESS_CONTEXT_PERSISTENCE_SCHEMA_VERSION,
            context_id: validContextId,
            tenant_id: validTenant,
            version: nextVersion,
            payload_sha256: payloadSha256,
            encryption_algorithm: 'aes-256-gcm',
            encryption_key_id: this.encryptionKeyId,
            retention_days: retentionDays,
            expires_at: expiresAt,
            legal_hold: legalHold,
            created_at: header.created_at,
            updated_at: nowIso,
            created_by: header.created_by,
            updated_by: actorId,
            ...(parsed.change_reason ? { change_reason: parsed.change_reason } : {}),
            input: parsed.input,
          });
        })
    );
  }

  getContext(
    tenantId: string,
    contextId: string,
    version?: number
  ): PersistedBusinessContext | null {
    return readPersistedBusinessContext(
      this.db,
      this.assertTenantId(tenantId),
      this.assertContextId(contextId),
      version,
      this.encryptionKey
    );
  }

  listContexts(tenantId: string): BusinessContextMetadata[] {
    return listTenantBusinessContexts(this.db, this.assertTenantId(tenantId));
  }

  exportContext(
    tenantId: string,
    contextId: string,
    actorId: string,
    taskRef = 'business-context-export'
  ): BusinessContextExportBundle {
    const validTenant = this.assertTenantId(tenantId);
    const validContextId = this.assertContextId(contextId);
    return this.runAudited(
      'economic.business_context.export',
      validTenant,
      validContextId,
      actorId,
      taskRef,
      { context_id: validContextId },
      () => {
        const context = this.getContext(validTenant, validContextId);
        if (!context) {
          throw new BusinessContextStoreError(
            'NOT_FOUND',
            `BusinessContext '${validContextId}' not found`
          );
        }
        return buildBusinessContextExport(
          this.db,
          this.clock,
          validTenant,
          validContextId,
          actorId,
          context
        );
      }
    );
  }

  backupContext(
    tenantId: string,
    contextId: string,
    actorId: string,
    taskRef = 'business-context-backup'
  ): BusinessContextEncryptedBackup {
    const validTenant = this.assertTenantId(tenantId);
    const validContextId = this.assertContextId(contextId);
    return this.runAudited(
      'economic.business_context.backup',
      validTenant,
      validContextId,
      actorId,
      taskRef,
      { context_id: validContextId },
      () => buildBusinessContextEncryptedBackup(this.db, this.clock, validTenant, validContextId)
    );
  }

  restoreBackup(
    tenantId: string,
    backup: BusinessContextEncryptedBackup,
    actorId: string,
    taskRef = 'business-context-restore'
  ): BusinessContextMetadata {
    const validTenant = this.assertTenantId(tenantId);
    return this.runAudited(
      'economic.business_context.restore',
      validTenant,
      backup?.context_id ?? 'unknown',
      actorId,
      taskRef,
      {
        context_id: backup?.context_id ?? 'unknown',
        version_count: Array.isArray(backup?.encrypted_versions)
          ? backup.encrypted_versions.length
          : 0,
      },
      () => verifyAndRestoreBusinessContextBackup(this.db, validTenant, backup, this.encryptionKey)
    );
  }

  deleteContext(
    tenantId: string,
    contextId: string,
    actorId: string,
    taskRef = 'business-context-delete',
    options: { forceLegalHold?: boolean } = {}
  ): BusinessContextDeletionReceipt {
    const validTenant = this.assertTenantId(tenantId);
    const validContextId = this.assertContextId(contextId);
    const forceLegalHold = Boolean(options.forceLegalHold);

    return this.runAudited(
      'economic.business_context.delete',
      validTenant,
      validContextId,
      actorId,
      taskRef,
      { context_id: validContextId, force_legal_hold: forceLegalHold },
      (intentId) =>
        executeVerifiedBusinessContextDelete(
          this.db,
          this.clock,
          validTenant,
          validContextId,
          actorId,
          intentId,
          forceLegalHold
        )
    );
  }

  purgeExpiredContexts(
    actorId: string,
    taskRef = 'business-context-retention-purge',
    tenantId?: string
  ): BusinessContextRetentionPurgeResult {
    const nowIso = new Date(this.clock.now()).toISOString();
    const expired = findExpiredBusinessContexts(
      this.db,
      nowIso,
      tenantId ? this.assertTenantId(tenantId) : undefined
    );
    const receipts = expired.map((row) =>
      this.deleteContext(row.tenant_id, row.context_id, actorId, taskRef)
    );
    return BusinessContextRetentionPurgeResultSchema.parse({
      purged_at: nowIso,
      purged_count: receipts.length,
      receipts,
    });
  }
}
