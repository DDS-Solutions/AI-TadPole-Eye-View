import { GevEvents } from '@gev/contracts';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/index.js';

describe('M1 Observer SSE Audit Stream (PLAN.md §10 Phase 1 Item 8)', () => {
  it('GET /ops/audit/stream establishes SSE stream and sends connected event', async () => {
    const { app, auditSink } = createApp();

    const intentId = crypto.randomUUID();
    // Log an event
    auditSink.intent({
      kind: GevEvents.AuditIntent,
      id: intentId,
      ts: new Date().toISOString(),
      actor: 'system',
      action: 'system.boot',
      target: 'kernel',
      task_ref: 'task-test-01',
    });

    const res = await app.request('/ops/audit/stream');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) throw new Error('Reader expected');

    const decoder = new TextDecoder();
    let accumulated = '';

    for (let i = 0; i < 5; i++) {
      const chunk = await reader.read();
      if (chunk.done) break;
      accumulated += decoder.decode(chunk.value, { stream: true });
      if (accumulated.includes(intentId)) break;
    }

    expect(accumulated).toContain('event: audit.connected');
    expect(accumulated).toContain('M1_OBSERVER');
    expect(accumulated).toContain(intentId);

    await reader.cancel();
  });
});
