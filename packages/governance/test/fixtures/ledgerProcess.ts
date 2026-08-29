import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const dbPath = process.argv[2];
const operationId = process.argv[3];
if (!dbPath || !operationId) {
  throw new Error('Usage: ledgerProcess.ts <dbPath> <operation-id>');
}

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA foreign_keys = ON;');

function withImmediateTransaction<T>(operationFn: () => T): T {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = operationFn();
    db.exec('COMMIT;');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // Preserve the original child-process failure.
    }
    throw error;
  }
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
    .join(',')}}`;
}

function appendAuditIntent(operationIdValue: string, now: string): void {
  const params = canonicalize({ stable: true });
  const row = {
    id: operationIdValue,
    kind: 'audit.intent',
    intent_id: null,
    ts: now,
    actor: 'system',
    action: 'tool.concurrent_test',
    target: 'concurrent_test',
    params,
    task_ref: 'two-process-ledger-test',
    status: null,
    result: null,
    error: null,
    duration_ms: null,
  };
  const state = db
    .prepare(
      'SELECT head_sequence, head_hash FROM governance_audit_chain_state WHERE singleton_id = 1'
    )
    .get() as { head_sequence: number; head_hash: string };
  const sequence = state.head_sequence + 1;
  const payload = canonicalize({
    format: 'gev.audit.event.v1',
    redaction_version: 'gev.audit.redaction.v1',
    row,
  });
  const payloadHash = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
  const link = canonicalize({
    format: 'gev.audit.link.v1',
    chain_version: 'gev.audit.chain.v1',
    payload_hash: payloadHash,
    previous_hash: state.head_hash,
    sequence,
  });
  const chainHash = crypto.createHash('sha256').update(link, 'utf8').digest('hex');

  db.prepare(`INSERT INTO audit_events (
    id, kind, intent_id, ts, actor, action, target, params, task_ref,
    status, result, error, duration_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...Object.values(row));
  db.prepare(`INSERT INTO governance_audit_chain (
    sequence, event_id, chain_version, redaction_version, previous_hash,
    payload_hash, chain_hash, appended_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    sequence,
    operationIdValue,
    'gev.audit.chain.v1',
    'gev.audit.redaction.v1',
    state.head_hash,
    payloadHash,
    chainHash,
    now
  );
  db.prepare(`UPDATE governance_audit_chain_state SET head_sequence = ?, head_hash = ?,
    updated_at = ? WHERE singleton_id = 1`).run(sequence, chainHash, now);
}
try {
  const resultKind = withImmediateTransaction(() => {
    const existing = db
      .prepare('SELECT state FROM governance_budget_operations WHERE operation_id = ?')
      .get(operationId) as { state: string } | undefined;

    if (existing) {
      if (existing.state === 'RESERVED' || existing.state === 'EXECUTING') {
        return 'in_progress';
      }
      return 'replay';
    }

    let budget = db
      .prepare(
        'SELECT cap_microusd, spent_microusd, stasis_active, period_start FROM governance_budget_state WHERE singleton_id = 1'
      )
      .get() as
      | {
          cap_microusd: number;
          spent_microusd: number;
          stasis_active: number;
          period_start: string;
        }
      | undefined;

    if (!budget) {
      const initNow = new Date().toISOString();
      db.prepare(`
        INSERT OR IGNORE INTO governance_budget_state (
          singleton_id, period_start, spent_microusd, cap_microusd,
          warn_threshold_pct, stasis_active, trip_code, trip_at,
          resumed_by, stasis_message, revision
        ) VALUES (1, ?, 0, 1000000, 80, 0, NULL, NULL, NULL, NULL, 0)
      `).run(initNow);
      budget = db
        .prepare(
          'SELECT cap_microusd, spent_microusd, stasis_active, period_start FROM governance_budget_state WHERE singleton_id = 1'
        )
        .get() as {
        cap_microusd: number;
        spent_microusd: number;
        stasis_active: number;
        period_start: string;
      };
    }

    const held = db
      .prepare(
        "SELECT COALESCE(SUM(reserved_microusd), 0) AS held FROM governance_budget_operations WHERE state IN ('RESERVED', 'EXECUTING', 'IN_DOUBT')"
      )
      .get() as { held: number };

    const available = Math.max(0, budget.cap_microusd - budget.spent_microusd - held.held);
    const reserved = 250_000; // 0.25 USD

    const now = new Date().toISOString();
    const deadlineAt = new Date(Date.now() + 30_000).toISOString();

    appendAuditIntent(operationId, now);

    if (budget.stasis_active === 1 || reserved > available) {
      return 'denied';
    }

    const fingerprint = crypto.createHash('sha256').update(operationId).digest('hex');
    const componentsJson = JSON.stringify({
      actor: 'system',
      tenant_id: null,
      action: 'tool.concurrent_test',
      task_ref: 'two-process-ledger-test',
      estimate: { currency: 'usd', min: 0, max: 0.25 },
    });

    db.prepare(`
      INSERT INTO governance_budget_operations (
        operation_id, intent_id, contract_version, fingerprint_version, request_fingerprint,
        fingerprint_components_json, actor, tenant_id, action, task_ref, period_start, state,
        reserved_microusd, settled_microusd, deadline_at, created_at, execution_started_at,
        terminal_at, terminal_result_json, terminal_result_digest, evidence_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, NULL, NULL, NULL, NULL)
    `).run(
      operationId,
      operationId,
      'gev.m3.ledger.v1',
      'gev.m3.fingerprint.v1',
      fingerprint,
      componentsJson,
      'system',
      null,
      'tool.concurrent_test',
      'two-process-ledger-test',
      budget.period_start,
      'RESERVED',
      reserved,
      deadlineAt,
      now
    );

    db.prepare(`
      INSERT INTO governance_budget_ledger_entries (
        entry_id, operation_id, event_type, amount_microusd, recorded_at, detail_json
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      operationId,
      'reserved',
      reserved,
      now,
      JSON.stringify({ available_before: available })
    );

    return 'reserved';
  });

  process.stdout.write(resultKind);
} finally {
  db.close();
}
