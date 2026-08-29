import { type AuditIntegrityStatus, AuditIntegrityStatusSchema, GevEvents } from '@gev/contracts';
import { SystemClock } from '@gev/core';
import { SqliteAuditSink, inspectAuditIntegrity } from '@gev/governance';
import pc from 'picocolors';

export interface AuditTailOptions {
  limit?: number;
  taskRef?: string;
  serverUrl?: string;
}

export interface AuditVerifyOptions {
  serverUrl?: string;
  dbPath?: string;
}

function opsHeaders(): HeadersInit | undefined {
  const token = process.env.GEV_OPS_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

export async function runAuditVerify(
  options: AuditVerifyOptions = {}
): Promise<AuditIntegrityStatus> {
  const serverUrl = options.serverUrl ?? 'http://localhost:3000';
  let integrity: AuditIntegrityStatus | undefined;
  let source = 'local read-only snapshot';
  let receivedResponse = false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);
  try {
    const response = await fetch(`${serverUrl}/ops/audit/integrity`, {
      signal: controller.signal,
      headers: opsHeaders(),
    });
    receivedResponse = true;
    if (response.status === 401 || response.status === 403) {
      throw new Error('Connected audit integrity inspection requires operator authentication');
    }
    if (![200, 409, 503].includes(response.status)) {
      throw new Error('Connected audit integrity inspection failed closed');
    }
    const body = await response.json();
    integrity = AuditIntegrityStatusSchema.parse(body);
    source = 'connected server authority';
  } catch (error) {
    if (receivedResponse) throw error;
    integrity = inspectAuditIntegrity({ dbPath: options.dbPath });
  } finally {
    clearTimeout(timeout);
  }

  const headline =
    integrity.status === 'valid'
      ? pc.green('VALID')
      : integrity.status === 'invalid'
        ? pc.red('INVALID')
        : pc.yellow('UNAVAILABLE');
  console.log(pc.bold(pc.cyan('\n🔐 GEV v2 Audit Integrity')));
  console.log(
    pc.dim('─────────────────────────────────────────────────────────────────────────────')
  );
  console.log(` Status:       ${headline}`);
  console.log(` Source:       ${source}`);
  console.log(` Chain:        ${integrity.chain_version ?? 'not available'}`);
  console.log(
    ` Boundary:     ${integrity.anchor_sequence ?? '—'} → ${integrity.head_sequence ?? '—'}`
  );
  console.log(` Verified:     ${integrity.verified_entries} retained entries`);
  if (integrity.failure_code) {
    console.log(
      ` Failure:      ${pc.red(integrity.failure_code)}${integrity.failure_sequence ? ` at sequence ${integrity.failure_sequence}` : ''}`
    );
  }
  console.log(
    pc.dim('─────────────────────────────────────────────────────────────────────────────\n')
  );
  return integrity;
}

export async function runAuditTail(options: AuditTailOptions = {}): Promise<void> {
  const serverUrl = options.serverUrl ?? 'http://localhost:3000';
  const limit = options.limit ?? 20;

  // Try querying the running server first
  let entries: Array<{
    kind: string;
    ts: string;
    actor?: string;
    action?: string;
    task_ref?: string;
    status?: string;
    duration_ms?: number;
    error?: string;
  }> = [];
  let source = 'local';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 800);
    const query = options.taskRef
      ? `?task_ref=${encodeURIComponent(options.taskRef)}&limit=${limit}`
      : `?limit=${limit}`;
    const res = await fetch(`${serverUrl}/ops/audit${query}`, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      const data = (await res.json()) as { entries: typeof entries };
      entries = data.entries ?? [];
      source = 'server';
    }
  } catch {
    // Server offline — fall back to shared on-disk SQLite
  }

  if (source === 'local') {
    const clock = new SystemClock();
    const sink = new SqliteAuditSink({ clock });
    const localEntries = options.taskRef
      ? sink.tailByTaskRef(options.taskRef)
      : sink.tail({ limit });
    entries = localEntries as typeof entries;
    sink.close();
  }

  console.log(
    pc.bold(pc.cyan(`\n📜 GEV v2 Audit Trail (${entries.length} records from ${source})`))
  );
  console.log(
    pc.dim('─────────────────────────────────────────────────────────────────────────────')
  );

  if (entries.length === 0) {
    console.log(pc.dim('  (No audit records found)'));
  } else {
    for (const entry of entries) {
      const timeStr = entry.ts.split('T')[1]?.slice(0, 8) || entry.ts;
      if (entry.kind === GevEvents.AuditIntent) {
        console.log(
          ` ${pc.dim(timeStr)} ${pc.blue('[INTENT] ')} ${pc.bold((entry.action ?? '').padEnd(16))} ${pc.dim(`actor:${entry.actor}`)} ${pc.dim(`task:${entry.task_ref}`)}`
        );
      } else {
        const status = entry.status ?? 'unknown';
        const statusColor = status === 'ok' ? pc.green : status === 'blocked' ? pc.red : pc.yellow;
        const dur = entry.duration_ms !== undefined ? `(${entry.duration_ms}ms)` : '';
        console.log(
          ` ${pc.dim(timeStr)} ${pc.magenta('[OUTCOME]')} ${statusColor(status.padEnd(8))} ${dur} ${entry.error ? pc.red(`err: ${entry.error}`) : ''}`
        );
      }
    }
  }

  console.log(
    pc.dim('─────────────────────────────────────────────────────────────────────────────\n')
  );
}
