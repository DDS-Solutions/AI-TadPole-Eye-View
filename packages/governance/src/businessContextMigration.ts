import type { DatabaseSync } from 'node:sqlite';

export const BUSINESS_CONTEXT_SCHEMA_VERSION = 7;

export function migrateBusinessContextPersistence(db: DatabaseSync, appliedAt: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS governance_business_contexts (
      tenant_id TEXT NOT NULL,
      context_id TEXT NOT NULL,
      current_version INTEGER NOT NULL CHECK (current_version >= 1),
      encryption_key_id TEXT NOT NULL,
      retention_days INTEGER NOT NULL CHECK (retention_days BETWEEN 1 AND 3650),
      expires_at TEXT NOT NULL,
      legal_hold INTEGER NOT NULL DEFAULT 0 CHECK (legal_hold IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      PRIMARY KEY (tenant_id, context_id)
    );
    CREATE INDEX IF NOT EXISTS governance_business_contexts_tenant_updated_idx
      ON governance_business_contexts (tenant_id, updated_at);
    CREATE INDEX IF NOT EXISTS governance_business_contexts_retention_idx
      ON governance_business_contexts (expires_at, legal_hold);

    CREATE TABLE IF NOT EXISTS governance_business_context_versions (
      tenant_id TEXT NOT NULL,
      context_id TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version >= 1),
      encrypted_payload TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
      encryption_key_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      change_reason TEXT,
      PRIMARY KEY (tenant_id, context_id, version),
      FOREIGN KEY (tenant_id, context_id)
        REFERENCES governance_business_contexts (tenant_id, context_id)
        ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS governance_business_context_versions_lookup_idx
      ON governance_business_context_versions (tenant_id, context_id, version DESC);

    CREATE TRIGGER IF NOT EXISTS governance_business_context_versions_immutable_update
    BEFORE UPDATE ON governance_business_context_versions
    BEGIN
      SELECT RAISE(ABORT, 'business context versions are append only');
    END;
  `);

  db.prepare('INSERT INTO governance_schema_migrations (version, applied_at) VALUES (?, ?);').run(
    BUSINESS_CONTEXT_SCHEMA_VERSION,
    appliedAt
  );
}
