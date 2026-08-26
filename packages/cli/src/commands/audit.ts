import { GevEvents } from '@gev/contracts';
import { SystemClock } from '@gev/core';
import { SqliteAuditSink } from '@gev/governance';
import pc from 'picocolors';

export interface AuditTailOptions {
  limit?: number;
  taskRef?: string;
  serverUrl?: string;
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
