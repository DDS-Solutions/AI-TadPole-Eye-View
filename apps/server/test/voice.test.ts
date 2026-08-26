import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/index.js';
import { createVoiceRouter } from '../src/routes/voice.js';

describe('Voice Realtime Session Token Route (PLAN.md §10 Phase 1 Item 6)', () => {
  it('POST /api/voice/session provisions ephemeral client secret in dev/seed mode', async () => {
    const { app } = createApp();

    const res = await app.request('/api/voice/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-realtime-preview', voice: 'alloy' }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.client_secret.startsWith('ek_')).toBe(true);
    expect(data.expires_at).toBeGreaterThan(0);
    expect(data.model).toBe('gpt-4o-realtime-preview');
  });

  it('POST /api/voice/session enforces auth-default guard when requireAuth is enabled', async () => {
    const authApp = new Hono();
    authApp.route('/api/voice', createVoiceRouter({ requireAuth: true }));

    // Unauthenticated request should be rejected with 401
    const unauthRes = await authApp.request('/api/voice/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-realtime-preview' }),
    });

    expect(unauthRes.status).toBe(401);
  });
});
