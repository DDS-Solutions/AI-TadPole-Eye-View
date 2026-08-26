import { GevEvents } from '@gev/contracts';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/index.js';

describe('Server API & Governed Ops (@gev/server)', () => {
  it('GET /api/health returns system and governor status', async () => {
    const { app } = createApp();

    const res = await app.request('/api/health');
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.seed_mode).toBe(true);
    expect(data.stasis_active).toBe(false);
    expect(data.budget_remaining_usd).toBeGreaterThan(0);
  });

  it('GET /api/flights serves fixture batch in seed mode', async () => {
    const { app } = createApp();

    const res = await app.request('/api/flights');
    expect(res.status).toBe(200);

    const batch = await res.json();
    expect(batch.states).toBeDefined();
    expect(batch.states.length).toBe(10000);
  });

  it('POST /ops/seed/reload executes 5-step lifecycle and writes SQLite WAL', async () => {
    const { app, auditSink } = createApp();
    const taskRef = 'task-reload-test-01';

    // Execute mutating reload
    const res = await app.request('/ops/seed/reload', {
      method: 'POST',
      headers: {
        'X-Task-Ref': taskRef,
        'X-Actor': 'ai',
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.intent_id).toBeDefined();
    expect(body.result.reloaded).toBe(true);

    // Verify SQLite WAL records: Intent first, Outcome second
    const entries = auditSink.tailByTaskRef(taskRef);
    expect(entries.length).toBe(2);

    expect(entries[0]?.kind).toBe(GevEvents.AuditIntent);
    expect(entries[0]?.action).toBe('seed.reload');

    expect(entries[1]?.kind).toBe(GevEvents.AuditOutcome);
    expect(entries[1]?.status).toBe('ok');
    expect(entries[1]?.intent_id).toBe(body.intent_id);
    expect(entries[1]?.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('POST /ops/seed/reload blocks and logs STASIS trip when cap is breached', async () => {
    const { app, auditSink, budgetGovernor } = createApp();
    const taskRef = 'task-stasis-trip-01';

    // Artificially breach budget to trigger STASIS
    budgetGovernor.recordSpend(10.0);

    const res = await app.request('/ops/seed/reload', {
      method: 'POST',
      headers: {
        'X-Task-Ref': taskRef,
        'X-Actor': 'ai',
      },
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.status).toBe('blocked');
    expect(body.stasis_active).toBe(true);

    // Rule 1: Blocked action STILL left intent + outcome records in WAL
    const entries = auditSink.tailByTaskRef(taskRef);
    expect(entries.length).toBe(2);
    expect(entries[0]?.kind).toBe(GevEvents.AuditIntent);
    expect(entries[1]?.kind).toBe(GevEvents.AuditOutcome);
    expect(entries[1]?.status).toBe('blocked');
  });
});
