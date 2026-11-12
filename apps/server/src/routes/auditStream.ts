import type { AuditEntry } from '@gev/contracts';
import type { SimClock } from '@gev/core';
import { SystemClock } from '@gev/core';
import type { CapBudgetGovernor, SqliteAuditSink, StasisEvent } from '@gev/governance';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

export interface AuditStreamRouterOptions {
  clock?: SimClock;
  budgetGovernor?: CapBudgetGovernor;
}

function isSimClock(
  candidate: SimClock | AuditStreamRouterOptions | undefined
): candidate is SimClock {
  return Boolean(candidate && typeof (candidate as SimClock).now === 'function');
}

/**
 * M1 Observer Merge-Rung: Real-Time SSE Audit & STASIS Notification Stream
 * Exposes live audit events and STASIS notifications via SSE to external runtimes (Tadpole console).
 */
export function createAuditStreamRouter(
  auditSink: SqliteAuditSink,
  clockOrOptions?: SimClock | AuditStreamRouterOptions
) {
  const clock = isSimClock(clockOrOptions)
    ? clockOrOptions
    : (clockOrOptions?.clock ?? new SystemClock());
  const budgetGovernor = isSimClock(clockOrOptions) ? undefined : clockOrOptions?.budgetGovernor;
  const router = new Hono();

  router.get('/stream', async (c) => {
    return streamSSE(c, async (stream) => {
      const bufferedLive: Array<{ event: string; data: string }> = [];
      let replayDone = false;

      const writeOrBuffer = async (event: string, data: string) => {
        if (!replayDone) {
          bufferedLive.push({ event, data });
          return;
        }
        try {
          await stream.writeSSE({ event, data });
        } catch {
          // Stream disconnected
        }
      };

      // Attach listeners immediately so events arriving during initial replay are never missed.
      const unsubscribe = auditSink.subscribe((entry: AuditEntry) => {
        void writeOrBuffer(entry.kind, JSON.stringify(entry));
      });
      const unsubscribeStasis = budgetGovernor
        ? budgetGovernor.subscribeStasis((event: StasisEvent) => {
            void writeOrBuffer(event.kind, JSON.stringify(event));
          })
        : undefined;

      stream.onAbort(() => {
        unsubscribe();
        unsubscribeStasis?.();
      });

      // 1. Send initial connected event
      await stream.writeSSE({
        event: 'audit.connected',
        data: JSON.stringify({
          time: clock.iso(),
          status: 'connected',
          m_rung: 'M1_OBSERVER',
        }),
      });

      // 1b. Emit immediate STASIS state notification if already locked
      if (budgetGovernor) {
        const state = budgetGovernor.state();
        if (state.stasis_active) {
          await stream.writeSSE({
            event: 'stasis.entered',
            data: JSON.stringify({
              kind: 'stasis.entered',
              ts: state.last_trip?.at ?? clock.iso(),
              stasis_active: true,
              trip_code: state.last_trip?.code ?? 'BUDGET_BREACH',
              revision: budgetGovernor.stateRevision(),
            }),
          });
        }
      }

      // 2. Replay recent tail entries for initial synchronization
      const recent = auditSink.tail({ limit: 10 });
      for (const entry of recent) {
        await stream.writeSSE({
          event: entry.kind,
          data: JSON.stringify(entry),
        });
      }

      // 3. Flush buffered live events and switch to direct streaming
      replayDone = true;
      while (bufferedLive.length > 0 && !stream.aborted) {
        const item = bufferedLive.shift();
        if (item) {
          await stream.writeSSE(item);
        }
      }

      // Keep stream alive with periodic heartbeats
      while (!stream.aborted) {
        await stream.sleep(15000);
        if (!stream.aborted) {
          await stream.writeSSE({
            event: 'audit.heartbeat',
            data: JSON.stringify({ time: clock.iso() }),
          });
        }
      }
    });
  });

  return router;
}
