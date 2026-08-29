import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { GevEvents, type LedgerReservationRequest } from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectAuditIntegrity } from '../src/auditChainStore.js';
import type { AuditRetentionSigner, TrustedAuditRetentionKey } from '../src/auditRetention.js';
import { SqliteAuditSink } from '../src/auditSink.js';
import { createGovernanceRuntimeContext } from '../src/runtimeContext.js';

const START = 1_700_000_000_000;
const tempDirectories: string[] = [];

function tempDatabase(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-audit-chain-'));
  tempDirectories.push(directory);
  return path.join(directory, 'governance.sqlite');
}

function removeTempDirectory(directory: string): void {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
      return;
    } catch {
      if (attempt === 2)
        throw new Error(`Could not remove closed audit test directory: ${directory}`);
    }
  }
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) removeTempDirectory(directory);
});

function appendIntent(sink: SqliteAuditSink, clock: FrozenClock, index: number): string {
  const id = crypto.randomUUID();
  sink.intent({
    kind: GevEvents.AuditIntent,
    id,
    ts: clock.iso(),
    actor: 'system',
    action: 'audit.test.append',
    target: `fixture-${index}`,
    params: { index },
    task_ref: 'task-5.1.5-test',
  });
  clock.setTime(clock.now() + 1);
  return id;
}

function reservation(clock: FrozenClock, operationId: string): LedgerReservationRequest {
  return {
    operation_id: operationId,
    fingerprint_components: {
      contract_version: 'gev.m3.ledger.v1',
      fingerprint_version: 'gev.m3.fingerprint.v1',
      actor: 'system',
      tenant_id: null,
      action: 'tool.audit_migration_test',
      input: { stable: true },
      task_ref: 'task-5.1.5-migration',
      is_mutating: true,
      estimate: { currency: 'usd', min: 0, max: 0 },
    },
    deadline_at: new Date(clock.now() + 30_000).toISOString(),
    audit_intent: {
      kind: GevEvents.AuditIntent,
      id: operationId,
      ts: clock.iso(),
      actor: 'system',
      action: 'tool.audit_migration_test',
      target: 'audit-migration-test',
      params: { stable: true },
      task_ref: 'task-5.1.5-migration',
    },
  };
}

function createChain(dbPath: string): { ids: string[]; clock: FrozenClock } {
  const clock = new FrozenClock(START);
  const sink = new SqliteAuditSink({ dbPath, clock });
  const ids = [
    appendIntent(sink, clock, 1),
    appendIntent(sink, clock, 2),
    appendIntent(sink, clock, 3),
  ];
  sink.close();
  return { ids, clock };
}

function openMutable(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = OFF;');
  return db;
}

function signingProfile(): {
  signer: AuditRetentionSigner;
  trustedKey: TrustedAuditRetentionKey;
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const signerId = 'audit-retention-operator';
  const keyId = 'audit-retention-key-1';
  return {
    signer: {
      signerId,
      keyId,
      sign: (payload) => crypto.sign(null, Buffer.from(payload), privateKey),
    },
    trustedKey: {
      signerId,
      keyId,
      publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
      status: 'active',
    },
  };
}

describe('versioned SQLite audit chain', () => {
  it('migrates legacy rows without changing audit or M3 values', () => {
    const dbPath = tempDatabase();
    const clock = new FrozenClock(START);
    const runtime = createGovernanceRuntimeContext({ dbPath, clock, capUsd: 1 });
    const operationId = crypto.randomUUID();
    runtime.budgetLedger.reserve(reservation(clock, operationId));
    runtime.close();

    const legacy = openMutable(dbPath);
    const auditBefore = legacy.prepare('SELECT * FROM audit_events ORDER BY rowid').all();
    const operationsBefore = legacy
      .prepare('SELECT * FROM governance_budget_operations ORDER BY operation_id')
      .all();
    legacy.exec(`
      DROP TRIGGER governance_audit_events_immutable_update;
      DROP TRIGGER governance_audit_events_delete_guard;
      DROP TRIGGER governance_audit_chain_immutable_update;
      DROP TRIGGER governance_audit_chain_delete_guard;
      DROP TRIGGER governance_audit_receipts_immutable_update;
      DROP TRIGGER governance_audit_receipts_immutable_delete;
      DROP TABLE governance_audit_chain;
      DROP TABLE governance_audit_chain_state;
      DROP TABLE governance_audit_retention_receipts;
      DROP TABLE governance_audit_mutation_guard;
      DELETE FROM governance_schema_migrations WHERE version = 4;
    `);
    legacy.close();

    const migrated = new SqliteAuditSink({ dbPath, clock });
    expect(migrated.verifyIntegrity()).toMatchObject({
      status: 'valid',
      anchor_sequence: 0,
      head_sequence: auditBefore.length,
      verified_entries: auditBefore.length,
    });
    migrated.close();

    const inspected = new DatabaseSync(dbPath, { readOnly: true });
    expect(inspected.prepare('SELECT * FROM audit_events ORDER BY rowid').all()).toEqual(
      auditBefore
    );
    expect(
      inspected.prepare('SELECT * FROM governance_budget_operations ORDER BY operation_id').all()
    ).toEqual(operationsBefore);
    expect(
      inspected.prepare('SELECT DISTINCT redaction_version FROM governance_audit_chain').all()
    ).toEqual([{ redaction_version: 'legacy-preserved-v0' }]);
    inspected.close();
  });

  it('redacts credentials, private tenant fields, cycles, and oversized content before storage', () => {
    const dbPath = tempDatabase();
    const clock = new FrozenClock(START);
    const sink = new SqliteAuditSink({ dbPath, clock });
    const cyclic: Record<string, unknown> = { password: 'raw-password' };
    cyclic.self = cyclic;
    let published: unknown;
    sink.subscribe((entry) => {
      published = entry;
    });
    sink.intent({
      kind: GevEvents.AuditIntent,
      id: crypto.randomUUID(),
      ts: clock.iso(),
      actor: 'ai',
      action: 'tool.private_test',
      target: 'Bearer target-secret',
      params: {
        authorization: 'Bearer durable-secret',
        business_context: { business_name: 'Private Bakery', contact_email: 'owner@example.com' },
        safe: 'authorization=another-secret',
        oversized: 'x'.repeat(20_000),
        cyclic,
      },
      task_ref: 'task-redaction',
    });
    sink.outcome({
      kind: GevEvents.AuditOutcome,
      intent_id: (published as { id: string }).id,
      ts: clock.iso(),
      status: 'error',
      result: { api_key: 'result-secret', safe_count: 3 },
      error: 'Bearer outcome-secret',
    });
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const durable = JSON.stringify(db.prepare('SELECT * FROM audit_events ORDER BY rowid').all());
    db.close();
    const integrity = sink.verifyIntegrity();
    sink.close();
    expect(JSON.stringify(published)).not.toContain('durable-secret');
    expect(durable).not.toContain('raw-password');
    expect(durable).not.toContain('Private Bakery');
    expect(durable).not.toContain('owner@example.com');
    expect(durable).not.toContain('outcome-secret');
    expect(durable).not.toContain('result-secret');
    expect(durable).not.toContain('x'.repeat(100));
    expect(durable).toContain('[REDACTED]');
    expect(integrity.status).toBe('valid');
  });

  it.each([
    {
      name: 'changed payload',
      expected: 'PAYLOAD_HASH_MISMATCH',
      mutate: (db: DatabaseSync) => {
        db.exec('DROP TRIGGER governance_audit_events_immutable_update;');
        db.prepare("UPDATE audit_events SET target = 'tampered' WHERE rowid = 2").run();
      },
    },
    {
      name: 'changed hash',
      expected: 'PAYLOAD_HASH_MISMATCH',
      mutate: (db: DatabaseSync) => {
        db.exec('DROP TRIGGER governance_audit_chain_immutable_update;');
        db.prepare('UPDATE governance_audit_chain SET payload_hash = ? WHERE sequence = 2').run(
          '0'.repeat(64)
        );
      },
    },
    {
      name: 'changed link',
      expected: 'PREVIOUS_HASH_MISMATCH',
      mutate: (db: DatabaseSync) => {
        db.exec('DROP TRIGGER governance_audit_chain_immutable_update;');
        db.prepare('UPDATE governance_audit_chain SET previous_hash = ? WHERE sequence = 2').run(
          'f'.repeat(64)
        );
      },
    },
    {
      name: 'middle deletion',
      expected: 'SEQUENCE_GAP',
      mutate: (db: DatabaseSync) => {
        const row = db
          .prepare('SELECT event_id FROM governance_audit_chain WHERE sequence = 2')
          .get() as {
          event_id: string;
        };
        db.exec('UPDATE governance_audit_mutation_guard SET retention_active = 1;');
        db.prepare('DELETE FROM governance_audit_chain WHERE sequence = 2').run();
        db.prepare('DELETE FROM audit_events WHERE id = ?').run(row.event_id);
      },
    },
    {
      name: 'unchained insertion',
      expected: 'UNCHAINED_EVENT',
      mutate: (db: DatabaseSync) => {
        db.prepare(`INSERT INTO audit_events (id, kind, ts, actor, action, target, task_ref)
          VALUES (?, 'audit.intent', ?, 'system', 'audit.injected', 'test', 'tamper')`).run(
          crypto.randomUUID(),
          new Date(START).toISOString()
        );
      },
    },
    {
      name: 'reordering',
      expected: 'PAYLOAD_HASH_MISMATCH',
      mutate: (db: DatabaseSync) => {
        const rows = db
          .prepare('SELECT sequence, event_id FROM governance_audit_chain WHERE sequence IN (1, 2)')
          .all() as unknown as Array<{ sequence: number; event_id: string }>;
        db.exec('DROP TRIGGER governance_audit_chain_immutable_update;');
        db.prepare(
          "UPDATE governance_audit_chain SET event_id = 'swap-placeholder' WHERE sequence = 1"
        ).run();
        db.prepare('UPDATE governance_audit_chain SET event_id = ? WHERE sequence = 2').run(
          rows[0]?.event_id
        );
        db.prepare('UPDATE governance_audit_chain SET event_id = ? WHERE sequence = 1').run(
          rows[1]?.event_id
        );
      },
    },
    {
      name: 'tail truncation',
      expected: 'HEAD_MISMATCH',
      mutate: (db: DatabaseSync) => {
        const row = db
          .prepare('SELECT event_id FROM governance_audit_chain WHERE sequence = 3')
          .get() as {
          event_id: string;
        };
        db.exec('UPDATE governance_audit_mutation_guard SET retention_active = 1;');
        db.prepare('DELETE FROM governance_audit_chain WHERE sequence = 3').run();
        db.prepare('DELETE FROM audit_events WHERE id = ?').run(row.event_id);
      },
    },
    {
      name: 'malformed chain row',
      expected: 'MALFORMED_ROW',
      mutate: (db: DatabaseSync) => {
        db.exec('PRAGMA ignore_check_constraints = ON;');
        db.exec('DROP TRIGGER governance_audit_chain_immutable_update;');
        db.prepare(
          "UPDATE governance_audit_chain SET chain_hash = 'broken' WHERE sequence = 1"
        ).run();
      },
    },
  ])('detects $name without repair', ({ mutate, expected }) => {
    const dbPath = tempDatabase();
    const { clock } = createChain(dbPath);
    const db = openMutable(dbPath);
    mutate(db);
    db.close();
    expect(inspectAuditIntegrity({ dbPath, clock })).toMatchObject({
      status: 'invalid',
      failure_code: expected,
    });
    expect(() => new SqliteAuditSink({ dbPath, clock })).toThrow(/failed closed/);
  });

  it('reports structurally corrupt storage as unavailable without changing it', () => {
    const dbPath = tempDatabase();
    fs.writeFileSync(dbPath, 'not-a-sqlite-database', 'utf8');
    expect(inspectAuditIntegrity({ dbPath, clock: new FrozenClock(START) })).toMatchObject({
      status: 'unavailable',
      failure_code: 'STORAGE_UNAVAILABLE',
    });
    expect(fs.readFileSync(dbPath, 'utf8')).toBe('not-a-sqlite-database');
  });

  it('creates and verifies a signed retention boundary while keeping recent evidence', () => {
    const dbPath = tempDatabase();
    const clock = new FrozenClock(START);
    const { signer, trustedKey } = signingProfile();
    const runtime = createGovernanceRuntimeContext({
      dbPath,
      clock,
      auditIntegrity: {
        trustedRetentionKeys: [trustedKey],
        retentionPolicy: { minimumRetainedEntries: 2, maximumPruneEntries: 20 },
      },
    });
    for (let index = 0; index < 6; index += 1) appendIntent(runtime.auditSink, clock, index);
    const retained = runtime.auditSink.retain({
      actor: 'human',
      pruneThroughSequence: 3,
      reason: 'Approved local retention transition for deterministic test evidence',
      signer,
    });
    expect(retained).toMatchObject({ prunedEntries: 3, anchorSequence: 3 });
    expect(runtime.auditSink.verifyIntegrity()).toMatchObject({
      status: 'valid',
      anchor_sequence: 3,
      head_sequence: 8,
      verified_entries: 5,
      retention_receipts: 1,
    });
    runtime.close();

    const reopened = createGovernanceRuntimeContext({
      dbPath,
      clock,
      auditIntegrity: { trustedRetentionKeys: [trustedKey] },
    });
    expect(reopened.auditSink.verifyIntegrity().status).toBe('valid');
    reopened.close();

    expect(
      inspectAuditIntegrity({ dbPath, clock, trustedRetentionKeys: [trustedKey] }).status
    ).toBe('valid');
    expect(inspectAuditIntegrity({ dbPath, clock })).toMatchObject({
      status: 'invalid',
      failure_code: 'RETENTION_SIGNATURE_INVALID',
    });
  });

  it('refuses retention while STASIS or IN_DOUBT evidence is active', () => {
    const dbPath = tempDatabase();
    const clock = new FrozenClock(START);
    const { signer, trustedKey } = signingProfile();
    const runtime = createGovernanceRuntimeContext({
      dbPath,
      clock,
      auditIntegrity: {
        trustedRetentionKeys: [trustedKey],
        retentionPolicy: { minimumRetainedEntries: 1, maximumPruneEntries: 20 },
      },
    });
    for (let index = 0; index < 3; index += 1) appendIntent(runtime.auditSink, clock, index);
    const operationId = crypto.randomUUID();
    const reserved = runtime.budgetLedger.reserve(reservation(clock, operationId));
    if (reserved.kind !== 'reserved') throw new Error('Expected a reserved audit test operation');
    runtime.budgetLedger.startExecution(operationId, reserved.operation.request_fingerprint);
    runtime.budgetLedger.markInDoubt({
      operation_id: operationId,
      request_fingerprint: reserved.operation.request_fingerprint,
      reason: 'Executed audit test operation has an ambiguous outcome',
      audit_outcome: {
        kind: GevEvents.AuditOutcome,
        intent_id: operationId,
        ts: clock.iso(),
        status: 'error',
        result: { code: 'OPERATION_IN_DOUBT' },
        error: 'Ambiguous outcome requires human reconciliation',
      },
    });
    expect(runtime.budgetLedger.lookup(operationId)?.state).toBe('IN_DOUBT');
    expect(runtime.budgetGovernor.state().stasis_active).toBe(true);
    expect(() =>
      runtime.auditSink.retain({
        actor: 'human',
        pruneThroughSequence: 1,
        reason: 'Attempted retention during active compliance incident',
        signer,
      })
    ).toThrow(/active incident/);
    expect(runtime.auditSink.verifyIntegrity()).toMatchObject({
      status: 'valid',
      anchor_sequence: 0,
      retention_receipts: 0,
    });
    expect(runtime.budgetLedger.lookup(operationId)?.state).toBe('IN_DOUBT');
    runtime.close();
  });
});
