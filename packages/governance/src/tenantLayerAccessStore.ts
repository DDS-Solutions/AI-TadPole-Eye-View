import type { DatabaseSync } from 'node:sqlite';
import {
  type LayerAccessCredentialState,
  type LayerAccessProviderRuntimeInput,
  type LayerAccessTermsState,
  type TenantLayerCredentialRecord,
  TenantLayerCredentialRecordSchema,
  type TenantLayerCredentialSubmission,
  TenantLayerCredentialSubmissionSchema,
  type TenantLayerTermsAcceptance,
  TenantLayerTermsAcceptanceSchema,
  type TenantLayerTermsRecord,
  TenantLayerTermsRecordSchema,
} from '@gev/contracts';
import type { SimClock } from '@gev/core';
import { computeMaskedFingerprint, decryptSecret, encryptSecret } from './layerAccessCrypto.js';

export interface TenantLayerAccessStoreOptions {
  encryptionKey?: Buffer;
}

interface CredentialDbRow {
  tenant_id: string;
  provider_id: string;
  secret_kind: 'api_key' | 'token' | 'client_secret';
  encrypted_secret: string;
  masked_fingerprint: string;
  status: LayerAccessCredentialState;
  validation_error: string | null;
  created_at: string;
  updated_at: string;
  validated_at: string | null;
  revoked_at: string | null;
}

interface TermsDbRow {
  tenant_id: string;
  provider_id: string;
  terms_id: string;
  status: LayerAccessTermsState;
  reviewed_url: string;
  version_digest: string;
  approved_by: string;
  approved_use_json: string;
  approved_environments_json: string;
  reviewed_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

export class SqliteTenantLayerAccessStore {
  private readonly db: DatabaseSync;
  private readonly clock: SimClock;
  private readonly encryptionKey?: Buffer;

  constructor(db: DatabaseSync, clock: SimClock, options: TenantLayerAccessStoreOptions = {}) {
    this.db = db;
    this.clock = clock;
    this.encryptionKey = options.encryptionKey;
  }

  submitCredential(
    tenantId: string,
    submission: TenantLayerCredentialSubmission,
    _actor: string
  ): TenantLayerCredentialRecord {
    const validated = TenantLayerCredentialSubmissionSchema.parse(submission);
    const nowIso = new Date(this.clock.now()).toISOString();
    const encrypted = encryptSecret(validated.secret_value, this.encryptionKey);
    const masked = computeMaskedFingerprint(validated.secret_value);

    const existing = this.db
      .prepare(
        'SELECT created_at FROM governance_tenant_layer_credentials WHERE tenant_id = ? AND provider_id = ?'
      )
      .get(tenantId, validated.provider_id) as { created_at: string } | undefined;

    const createdAt = existing?.created_at ?? nowIso;
    const status: LayerAccessCredentialState = 'pending_validation';

    this.db
      .prepare(
        `INSERT INTO governance_tenant_layer_credentials (
          tenant_id, provider_id, secret_kind, encrypted_secret, masked_fingerprint,
          status, validation_error, created_at, updated_at, validated_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL)
        ON CONFLICT(tenant_id, provider_id) DO UPDATE SET
          secret_kind = excluded.secret_kind,
          encrypted_secret = excluded.encrypted_secret,
          masked_fingerprint = excluded.masked_fingerprint,
          status = excluded.status,
          validation_error = NULL,
          updated_at = excluded.updated_at,
          validated_at = NULL,
          revoked_at = NULL`
      )
      .run(
        tenantId,
        validated.provider_id,
        validated.secret_kind,
        encrypted,
        masked,
        status,
        createdAt,
        nowIso
      );

    return TenantLayerCredentialRecordSchema.parse({
      tenant_id: tenantId,
      provider_id: validated.provider_id,
      secret_kind: validated.secret_kind,
      masked_fingerprint: masked,
      status,
      validated_at: null,
      validation_error: null,
      created_at: createdAt,
      updated_at: nowIso,
      revoked_at: null,
    });
  }

  async validateCredential(
    tenantId: string,
    providerId: string,
    validator?: (providerId: string, secret: string) => Promise<{ valid: boolean; error?: string }>,
    options?: { timeoutMs?: number }
  ): Promise<TenantLayerCredentialRecord> {
    const row = this.db
      .prepare(
        'SELECT * FROM governance_tenant_layer_credentials WHERE tenant_id = ? AND provider_id = ?'
      )
      .get(tenantId, providerId) as CredentialDbRow | undefined;

    if (!row) {
      throw new Error(
        `No credential record found for tenant '${tenantId}' and provider '${providerId}'`
      );
    }

    if (row.status === 'revoked') {
      throw new Error(`Cannot validate revoked credential for provider '${providerId}'`);
    }

    const rawSecret = decryptSecret(row.encrypted_secret, this.encryptionKey);
    const nowIso = new Date(this.clock.now()).toISOString();

    let valid = true;
    let errorMessage: string | null = null;

    if (validator) {
      const boundedTimeoutMs = Math.min(Math.max(1, options?.timeoutMs ?? 5_000), 5_000);
      const timeoutPromise = new Promise<{ valid: boolean; error?: string }>((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('Validation request exceeded 5s bounded timeout'));
        }, boundedTimeoutMs);
        if (typeof timer.unref === 'function') timer.unref();
      });

      try {
        const res = await Promise.race([validator(providerId, rawSecret), timeoutPromise]);
        valid = res.valid;
        if (!valid) errorMessage = res.error ?? 'Credential validation failed';
      } catch (err) {
        valid = false;
        errorMessage = err instanceof Error ? err.message : String(err);
      }
    }

    const newStatus: LayerAccessCredentialState = valid ? 'valid' : 'invalid';
    const validatedAt = valid ? nowIso : null;

    this.db
      .prepare(
        `UPDATE governance_tenant_layer_credentials
         SET status = ?, validated_at = ?, validation_error = ?, updated_at = ?
         WHERE tenant_id = ? AND provider_id = ?`
      )
      .run(newStatus, validatedAt, errorMessage, nowIso, tenantId, providerId);

    return TenantLayerCredentialRecordSchema.parse({
      tenant_id: tenantId,
      provider_id: providerId,
      secret_kind: row.secret_kind,
      masked_fingerprint: row.masked_fingerprint,
      status: newStatus,
      validated_at: validatedAt,
      validation_error: errorMessage,
      created_at: row.created_at,
      updated_at: nowIso,
      revoked_at: row.revoked_at,
    });
  }

  revokeCredential(
    tenantId: string,
    providerId: string,
    reason: string,
    _actor: string
  ): TenantLayerCredentialRecord {
    const row = this.db
      .prepare(
        'SELECT * FROM governance_tenant_layer_credentials WHERE tenant_id = ? AND provider_id = ?'
      )
      .get(tenantId, providerId) as CredentialDbRow | undefined;

    if (!row) {
      throw new Error(
        `No credential record found for tenant '${tenantId}' and provider '${providerId}'`
      );
    }

    const nowIso = new Date(this.clock.now()).toISOString();
    this.db
      .prepare(
        `UPDATE governance_tenant_layer_credentials
         SET status = 'revoked', revoked_at = ?, validation_error = ?, updated_at = ?
         WHERE tenant_id = ? AND provider_id = ?`
      )
      .run(nowIso, reason, nowIso, tenantId, providerId);

    return TenantLayerCredentialRecordSchema.parse({
      tenant_id: tenantId,
      provider_id: providerId,
      secret_kind: row.secret_kind,
      masked_fingerprint: row.masked_fingerprint,
      status: 'revoked',
      validated_at: row.validated_at,
      validation_error: reason,
      created_at: row.created_at,
      updated_at: nowIso,
      revoked_at: nowIso,
    });
  }

  deleteCredential(tenantId: string, providerId: string, _actor: string): boolean {
    const result = this.db
      .prepare(
        'DELETE FROM governance_tenant_layer_credentials WHERE tenant_id = ? AND provider_id = ?'
      )
      .run(tenantId, providerId);
    return Number(result.changes) > 0;
  }

  getCredentialRecord(tenantId: string, providerId: string): TenantLayerCredentialRecord | null {
    const row = this.db
      .prepare(
        'SELECT * FROM governance_tenant_layer_credentials WHERE tenant_id = ? AND provider_id = ?'
      )
      .get(tenantId, providerId) as CredentialDbRow | undefined;

    if (!row) return null;
    return TenantLayerCredentialRecordSchema.parse({
      tenant_id: row.tenant_id,
      provider_id: row.provider_id,
      secret_kind: row.secret_kind,
      masked_fingerprint: row.masked_fingerprint,
      status: row.status,
      validated_at: row.validated_at,
      validation_error: row.validation_error,
      created_at: row.created_at,
      updated_at: row.updated_at,
      revoked_at: row.revoked_at,
    });
  }

  getDecryptedSecret(tenantId: string, providerId: string): string | null {
    const row = this.db
      .prepare(
        'SELECT encrypted_secret, status FROM governance_tenant_layer_credentials WHERE tenant_id = ? AND provider_id = ?'
      )
      .get(tenantId, providerId) as { encrypted_secret: string; status: string } | undefined;

    if (row?.status !== 'valid') return null;
    return decryptSecret(row.encrypted_secret, this.encryptionKey);
  }

  acceptTerms(
    tenantId: string,
    acceptance: TenantLayerTermsAcceptance,
    actor: string
  ): TenantLayerTermsRecord {
    const validated = TenantLayerTermsAcceptanceSchema.parse(acceptance);
    const nowIso = new Date(this.clock.now()).toISOString();

    this.db
      .prepare(
        `INSERT INTO governance_tenant_layer_terms (
          tenant_id, provider_id, terms_id, status, reviewed_url, version_digest,
          approved_by, approved_use_json, approved_environments_json, reviewed_at, expires_at, revoked_at
        ) VALUES (?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(tenant_id, provider_id) DO UPDATE SET
          terms_id = excluded.terms_id,
          status = 'approved',
          reviewed_url = excluded.reviewed_url,
          version_digest = excluded.version_digest,
          approved_by = excluded.approved_by,
          approved_use_json = excluded.approved_use_json,
          approved_environments_json = excluded.approved_environments_json,
          reviewed_at = excluded.reviewed_at,
          expires_at = excluded.expires_at,
          revoked_at = NULL`
      )
      .run(
        tenantId,
        validated.provider_id,
        validated.terms_id,
        validated.reviewed_url,
        validated.version_digest,
        actor,
        JSON.stringify(validated.approved_use),
        JSON.stringify(validated.approved_environments),
        nowIso,
        validated.expires_at ?? null
      );

    return TenantLayerTermsRecordSchema.parse({
      tenant_id: tenantId,
      provider_id: validated.provider_id,
      terms_id: validated.terms_id,
      status: 'approved',
      reviewed_url: validated.reviewed_url,
      version_digest: validated.version_digest,
      approved_by: actor,
      approved_use: validated.approved_use,
      approved_environments: validated.approved_environments,
      reviewed_at: nowIso,
      expires_at: validated.expires_at ?? null,
      revoked_at: null,
    });
  }

  revokeTerms(
    tenantId: string,
    providerId: string,
    _reason: string,
    _actor: string
  ): TenantLayerTermsRecord {
    const row = this.db
      .prepare(
        'SELECT * FROM governance_tenant_layer_terms WHERE tenant_id = ? AND provider_id = ?'
      )
      .get(tenantId, providerId) as TermsDbRow | undefined;

    if (!row) {
      throw new Error(
        `No terms record found for tenant '${tenantId}' and provider '${providerId}'`
      );
    }

    const nowIso = new Date(this.clock.now()).toISOString();
    this.db
      .prepare(
        `UPDATE governance_tenant_layer_terms
         SET status = 'rejected', revoked_at = ?
         WHERE tenant_id = ? AND provider_id = ?`
      )
      .run(nowIso, tenantId, providerId);

    return TenantLayerTermsRecordSchema.parse({
      tenant_id: row.tenant_id,
      provider_id: row.provider_id,
      terms_id: row.terms_id,
      status: 'rejected',
      reviewed_url: row.reviewed_url,
      version_digest: row.version_digest,
      approved_by: row.approved_by,
      approved_use: JSON.parse(row.approved_use_json),
      approved_environments: JSON.parse(row.approved_environments_json),
      reviewed_at: row.reviewed_at,
      expires_at: row.expires_at,
      revoked_at: nowIso,
    });
  }

  getTermsRecord(tenantId: string, providerId: string): TenantLayerTermsRecord | null {
    const row = this.db
      .prepare(
        'SELECT * FROM governance_tenant_layer_terms WHERE tenant_id = ? AND provider_id = ?'
      )
      .get(tenantId, providerId) as TermsDbRow | undefined;

    if (!row) return null;
    return TenantLayerTermsRecordSchema.parse({
      tenant_id: row.tenant_id,
      provider_id: row.provider_id,
      terms_id: row.terms_id,
      status: row.status,
      reviewed_url: row.reviewed_url,
      version_digest: row.version_digest,
      approved_by: row.approved_by,
      approved_use: JSON.parse(row.approved_use_json),
      approved_environments: JSON.parse(row.approved_environments_json),
      reviewed_at: row.reviewed_at,
      expires_at: row.expires_at,
      revoked_at: row.revoked_at,
    });
  }

  getTenantRuntimeInputs(tenantId: string): LayerAccessProviderRuntimeInput[] {
    const credRows = this.db
      .prepare('SELECT * FROM governance_tenant_layer_credentials WHERE tenant_id = ?')
      .all(tenantId) as unknown as CredentialDbRow[];

    const termsRows = this.db
      .prepare('SELECT * FROM governance_tenant_layer_terms WHERE tenant_id = ?')
      .all(tenantId) as unknown as TermsDbRow[];

    const now = this.clock.now();
    const credMap = new Map<string, CredentialDbRow>();
    for (const r of credRows) credMap.set(r.provider_id, r);

    const termsMap = new Map<string, TermsDbRow>();
    for (const r of termsRows) termsMap.set(r.provider_id, r);

    const allProviders = new Set([...credMap.keys(), ...termsMap.keys()]);
    const inputs: LayerAccessProviderRuntimeInput[] = [];

    for (const providerId of allProviders) {
      const cred = credMap.get(providerId);
      const terms = termsMap.get(providerId);

      let effectiveTermsStatus: LayerAccessTermsState = 'unreviewed';
      if (terms) {
        if (terms.revoked_at) {
          effectiveTermsStatus = 'rejected';
        } else if (terms.expires_at && Date.parse(terms.expires_at) <= now) {
          effectiveTermsStatus = 'expired';
        } else {
          effectiveTermsStatus = terms.status;
        }
      }

      inputs.push({
        provider_id: providerId,
        credential: cred
          ? {
              status: cred.status,
              masked_fingerprint: cred.masked_fingerprint,
              validated_at: cred.validated_at,
            }
          : undefined,
        terms: terms
          ? {
              status: effectiveTermsStatus,
              reviewed_at: terms.reviewed_at,
              expires_at: terms.expires_at,
            }
          : undefined,
      });
    }

    return inputs;
  }
}
