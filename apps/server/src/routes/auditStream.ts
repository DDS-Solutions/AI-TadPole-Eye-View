import type { AuditEntry } from '@gev/contracts';
import type { SqliteAuditSink } from '@gev/governance';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

export interface AuditStreamRouterOptions {
  auditSink: SqliteAuditSink;
}

/**
 * M1 Observer Merge-Rung: Real-Time SSE Audit Stream (PLAN.md §6 & §10 Phase 1 Item 8)
 * Exposes live audit events via Server-Sent Events to external runtimes (Tadpole console).
 */
export function createAuditStreamRouter(auditSink: SqliteAuditSink) {
  const router = new Hono();

  router.get('/stream', async (c) => {
    return streamSSE(c, async (stream) => {
      // 1. Send initial connected event
      await stream.writeSSE({
        event: 'audit.connected',
        data: JSON.stringify({
          time: new Date().toISOString(),
          status: 'connected',
          m_rung: 'M1_OBSERVER',
        }),
      });

      // 2. Replay recent tail entries for initial synchronization
      const recent = auditSink.tail({ limit: 10 });
      for (const entry of recent) {
        await stream.writeSSE({
          event: entry.kind,
          data: JSON.stringify(entry),
        });
      }

      // 3. Attach real-time listener
      const unsubscribe = auditSink.subscribe(async (entry: AuditEntry) => {
        try {
          await stream.writeSSE({
            event: entry.kind,
            data: JSON.stringify(entry),
          });
        } catch {
          // Stream disconnected
        }
      });

      // 4. Handle client disconnection
      stream.onAbort(() => {
        unsubscribe();
      });

      // Keep stream alive with periodic heartbeats
      while (!stream.aborted) {
        await stream.sleep(15000);
        if (!stream.aborted) {
          await stream.writeSSE({
            event: 'audit.heartbeat',
            data: JSON.stringify({ time: new Date().toISOString() }),
          });
        }
      }
    });
  });

  return router;
}
