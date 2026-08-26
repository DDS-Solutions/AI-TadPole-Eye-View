import { GevEvents } from '@gev/contracts';
import { SystemClock } from '@gev/core';
import { SqliteAuditSink } from '@gev/governance';
import pc from 'picocolors';

export interface AuditTailOptions {
  limit?: number;
  taskRef?: string;
}

export async function runAuditTail(options: AuditTailOptions = {}): Promise<void> {
  const clock = new SystemClock();
  const sink = new SqliteAuditSink({ clock });
  const limit = options.limit ?? 20;

  const entries = options.taskRef ? sink.tailByTaskRef(options.taskRef) : sink.tail({ limit });

  console.log(pc.bold(pc.cyan(`\n📜 GEV v2 Audit Trail (Recent ${entries.length} records)`)));
  console.log(
    pc.dim('─────────────────────────────────────────────────────────────────────────────')
  );

  if (entries.length === 0) {
    console.log(pc.dim('  (No audit records found in local SQLite WAL)'));
  } else {
    for (const entry of entries) {
      const timeStr = entry.ts.split('T')[1]?.slice(0, 8) || entry.ts;
      if (entry.kind === GevEvents.AuditIntent) {
        console.log(
          ` ${pc.dim(timeStr)} ${pc.blue('[INTENT] ')} ${pc.bold(entry.action.padEnd(16))} ${pc.dim(`actor:${entry.actor}`)} ${pc.dim(`task:${entry.task_ref}`)}`
        );
      } else {
        const statusColor =
          entry.status === 'ok' ? pc.green : entry.status === 'blocked' ? pc.red : pc.yellow;
        const dur = entry.duration_ms !== undefined ? `(${entry.duration_ms}ms)` : '';
        console.log(
          ` ${pc.dim(timeStr)} ${pc.magenta('[OUTCOME]')} ${statusColor(entry.status.padEnd(8))} ${dur} ${entry.error ? pc.red(`err: ${entry.error}`) : ''}`
        );
      }
    }
  }

  console.log(
    pc.dim('─────────────────────────────────────────────────────────────────────────────\n')
  );
}
