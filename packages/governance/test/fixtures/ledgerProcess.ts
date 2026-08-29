import crypto from 'node:crypto';
import { openGovernanceDatabase, withImmediateTransaction } from '../../src/governanceDb.ts';

const dbPath = process.argv[2];
const operationId = process.argv[3];
if (!dbPath || !operationId) {
  throw new Error('Usage: ledgerProcess.ts <dbPath> <operation-id>');
}

const { db } = openGovernanceDatabase({ dbPath });
try {
  const resultKind = withImmediateTransaction(db, () => {
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

    db.prepare(`
      INSERT INTO audit_events (id, kind, ts, actor, action, target, params, task_ref)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      operationId,
      'audit.intent',
      now,
      'system',
      'tool.concurrent_test',
      'concurrent_test',
      JSON.stringify({ stable: true }),
      'two-process-ledger-test'
    );

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
