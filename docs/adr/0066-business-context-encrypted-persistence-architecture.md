# ADR 0066: Encrypted, Versioned, Tenant-Isolated BusinessContext Persistence

- **Status:** Accepted
- **Date:** 2026-11-27
- **Plan Reference:** `PLAN.md` §10 Task 13.1
- **Related ADRs:** ADR 0031, ADR 0038, ADR 0041, ADR 0042, ADR 0044, ADR 0052, ADR 0053

## Context

Prior to Phase 13, `BusinessContext` existed only as a stateless request payload for economic preview (`ADR 0053`). Task 13.1 requires durable, versioned persistence of SMB `BusinessContext` records with strict tenant isolation, encryption at rest, retention policy, backup, export, verified hard deletion, and full M1 intent/outcome audit coverage.

## Decision

1. **Governance SQLite Schema Migration v7 (`packages/governance/src/businessContextMigration.ts`):**
   - Bump `GOVERNANCE_SCHEMA_VERSION` from `6` to `7`.
   - Create `governance_business_contexts` (primary key `(tenant_id, context_id)`) storing strictly non-sensitive lifecycle/retention metadata and `governance_business_context_versions` (primary key `(tenant_id, context_id, version)`) storing immutable encrypted version snapshots with `FOREIGN KEY ... ON DELETE CASCADE`.
   - Enforce append-only version immutability via SQLite trigger `governance_business_context_versions_immutable_update`.

2. **Encryption at Rest with Tenant-Bound AAD (`packages/governance/src/businessContextCrypto.ts`):**
   - Encrypt canonicalized `BusinessContextInput` JSON using AES-256-GCM via `encryptSecret` / `decryptSecret` (`layerAccessCrypto.ts`, requiring `GEV_CREDENTIAL_KEY` in production).
   - Bind tenant, context, and version cryptographically via AAD `business_context.v1:${tenantId}:${contextId}:v${version}` and store a `payload_sha256` digest. Any ciphertext tampering, key mismatch, or cross-tenant row copy fails decryption closed (`INTEGRITY_ERROR`).

3. **Pre-Parse Structural Guards & Corrupt-Save Protection (`packages/contracts/src/businessContextPersistence.ts`):**
   - Reject payloads exceeding `65,536` UTF-8 bytes, nesting depth `> 16`, or prototype keys (`__proto__`, `constructor`, `prototype`) before domain validation.
   - Require `expected_version` optimistic concurrency on updates (`VERSION_CONFLICT` on mismatch) and refuse silent clobber during backup restore (`ALREADY_EXISTS`).

4. **Backup, Export, Retention & Verified Hard Deletion (`packages/governance/src/businessContextBackup.ts`, `packages/governance/src/businessContextStore.ts`):**
   - Backups (`gev.business_context.backup.v1`) remain ciphertext-only with a `backup_sha256` integrity digest; restores verify tenant ownership, digest, and decryptability of every version before writing atomically.
   - Exports (`gev.business_context.export.v1`) decrypt for authorized tenant/platform admins and attach full version history + `bundle_sha256`.
   - Hard deletion enforces `legal_hold` (overridable only by `platform_admin`), executes transactional `DELETE` across both tables, verifies `COUNT(*) = 0` on both tables, and returns a `BusinessContextDeletionReceipt` (`verified_zero_remaining: true`).
   - Every mutation, export, backup, restore, and deletion emits M1 `audit.intent` BEFORE and `audit.outcome` AFTER, using redacted summaries (`redactBusinessContextForAudit`) that never log sensitive business names, revenues, or employee counts.

5. **Protected HTTP Surface (`apps/server/src/routes/businessContextRoutes.ts`):**
   - Mount `/api/economic/contexts*` under `createEconomicRouter` behind `opsAuth`, tenant isolation, kill-switch (`economic`), global/tenant STASIS (`423`), per-tenant rate limits (`429`), and `Cache-Control: no-store`. Restrict `ai_copilot` to non-sensitive metadata listing only.

## Consequences

- Sensitive SMB parameters never appear in plaintext in SQLite tables, encrypted backups, or audit WAL entries.
- Deleting a `BusinessContext` provably eliminates all version rows with zero orphans and leaves a verifiable receipt anchored to the hash-chained M1 audit log.
