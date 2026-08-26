import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createVoiceRouter } from '../src/routes/voice.js';

describe('Voice Realtime Session Token Route (PLAN.md §10 Phase 1 Item 6)', () => {
  const originalOpsToken = process.env.GEV_OPS_TOKEN;

  beforeEach(() => {
    process.env.GEV_OPS_TOKEN = 'test_secret_token_123';
  });

  afterEach(() => {
    process.env.GEV_OPS_TOKEN = originalOpsToken;
  });

  it('POST /api/voice/session provisions ephemeral client secret with valid Bearer token', async () => {
    const authApp = new Hono();
    authApp.route('/api/voice', createVoiceRouter({ requireAuth: true }));

    const res = await authApp.request('/api/voice/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_secret_token_123',
      },
      body: JSON.stringify({ model: 'gpt-4o-realtime-preview', voice: 'alloy' }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { client_secret: string; expires_at: number; model: string };
    expect(data.client_secret.startsWith('ek_')).toBe(true);
    expect(data.expires_at).toBeGreaterThan(0);
    expect(data.model).toBe('gpt-4o-realtime-preview');
  });

  it('POST /api/voice/session rejects unauthorized request with 401 when requireAuth is enabled', async () => {
    const authApp = new Hono();
    authApp.route('/api/voice', createVoiceRouter({ requireAuth: true }));

    const unauthRes = await authApp.request('/api/voice/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-realtime-preview' }),
    });

    expect(unauthRes.status).toBe(401);
  });

  it('POST /api/voice/session fails closed with 503 when GEV_OPS_TOKEN is unconfigured', async () => {
    process.env.GEV_OPS_TOKEN = '';
    const authApp = new Hono();
    authApp.route('/api/voice', createVoiceRouter({ requireAuth: true }));

    const res = await authApp.request('/api/voice/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_secret_token_123',
      },
      body: JSON.stringify({ model: 'gpt-4o-realtime-preview' }),
    });

    expect(res.status).toBe(503);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain('GEV_OPS_TOKEN not configured');
  });

  it('POST /api/voice/session allows unauthenticated access when requireAuth is explicitly false', async () => {
    const noAuthApp = new Hono();
    noAuthApp.route('/api/voice', createVoiceRouter({ requireAuth: false }));

    const res = await noAuthApp.request('/api/voice/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-realtime-preview' }),
    });

    expect(res.status).toBe(200);
  });
});
