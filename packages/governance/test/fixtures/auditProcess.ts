import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const dbPath = process.argv[2];
const processLabel = process.argv[3];
const iterations = Number.parseInt(process.argv[4] ?? '', 10);
if (!dbPath || !processLabel || !Number.isSafeInteger(iterations) || iterations < 1) {
  throw new Error('Usage: auditProcess.ts <db-path> <process-label> <iterations>');
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

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA foreign_keys = ON;');
try {
  for (let index = 0; index < iterations; index += 1) {
    db.exec('BEGIN IMMEDIATE;');
    try {
      const state = db
        .prepare(
          'SELECT head_sequence, head_hash FROM governance_audit_chain_state WHERE singleton_id = 1'
        )
        .get() as { head_sequence: number; head_hash: string };
      const sequence = state.head_sequence + 1;
      const id = crypto.randomUUID();
      const now = new Date(1_700_000_000_000 + index).toISOString();
      const row = {
        id,
        kind: 'audit.intent',
        intent_id: null,
        ts: now,
        actor: 'system',
        action: 'audit.concurrent_append',
        target: processLabel,
        params: canonicalize({ index, process: processLabel }),
        task_ref: 'task-5.1.5-two-process',
        status: null,
        result: null,
        error: null,
        duration_ms: null,
      };
      const payloadHash = crypto
        .createHash('sha256')
        .update(
          canonicalize({
            format: 'gev.audit.event.v1',
            redaction_version: 'gev.audit.redaction.v1',
            row,
          }),
          'utf8'
        )
        .digest('hex');
      const chainHash = crypto
        .createHash('sha256')
        .update(
          canonicalize({
            format: 'gev.audit.link.v1',
            chain_version: 'gev.audit.chain.v1',
            payload_hash: payloadHash,
            previous_hash: state.head_hash,
            sequence,
          }),
          'utf8'
        )
        .digest('hex');
      db.prepare(`INSERT INTO audit_events (
        id, kind, intent_id, ts, actor, action, target, params, task_ref,
        status, result, error, duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...Object.values(row));
      db.prepare(`INSERT INTO governance_audit_chain (
        sequence, event_id, chain_version, redaction_version, previous_hash,
        payload_hash, chain_hash, appended_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        sequence,
        id,
        'gev.audit.chain.v1',
        'gev.audit.redaction.v1',
        state.head_hash,
        payloadHash,
        chainHash,
        now
      );
      const updated = db
        .prepare(`UPDATE governance_audit_chain_state SET head_sequence = ?, head_hash = ?,
          updated_at = ? WHERE singleton_id = 1 AND head_sequence = ? AND head_hash = ?`)
        .run(sequence, chainHash, now, state.head_sequence, state.head_hash);
      if (updated.changes !== 1) throw new Error('Concurrent audit head update was not serialized');
      db.exec('COMMIT;');
    } catch (error) {
      try {
        db.exec('ROLLBACK;');
      } catch {
        // Preserve the original process failure.
      }
      throw error;
    }
  }
} finally {
  db.close();
}
