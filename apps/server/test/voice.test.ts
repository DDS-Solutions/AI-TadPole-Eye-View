import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { type OpsAuthOptions, createOpsAuth } from '../src/middleware/opsAuth.js';
import { createVoiceRouter } from '../src/routes/voice.js';

describe('Voice Realtime Session Token Route (PLAN.md §10 Phase 1 Item 6)', () => {
  const opsToken = 'test_secret_token_123';

  function createVoiceApp(authOptions: OpsAuthOptions) {
    const app = new Hono();
    const auth = createOpsAuth(authOptions);
    app.route('/api/voice', createVoiceRouter({ auth, apiKey: 'mock_key' }));
    return app;
  }

  it('POST /api/voice/session provisions ephemeral client secret with valid Bearer token', async () => {
    const authApp = createVoiceApp({ opsToken, requireAuth: true });

    const res = await authApp.request('/api/voice/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opsToken}`,
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
    const authApp = createVoiceApp({ opsToken, requireAuth: true });

    const unauthRes = await authApp.request('/api/voice/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-realtime-preview' }),
    });

    expect(unauthRes.status).toBe(401);
  });

  it('POST /api/voice/session fails closed with 503 when GEV_OPS_TOKEN is unconfigured', async () => {
    const authApp = createVoiceApp({ opsToken: '', requireAuth: true });

    const res = await authApp.request('/api/voice/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opsToken}`,
      },
      body: JSON.stringify({ model: 'gpt-4o-realtime-preview' }),
    });

    expect(res.status).toBe(503);
    const data = (await res.json()) as { code: string; error: string };
    expect(data.code).toBe('AUTH_NOT_CONFIGURED');
    expect(data.error).toContain('GEV_OPS_TOKEN is not configured');
  });

  it('POST /api/voice/session preserves explicit local seed access with zero outbound calls', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Outbound HTTP is forbidden in this test'));
    const noAuthApp = createVoiceApp({ opsToken: '', requireAuth: false });

    try {
      const res = await noAuthApp.request('/api/voice/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-realtime-preview' }),
      });

      expect(res.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('enforces a configured token even when local auth is not otherwise required', async () => {
    const authApp = createVoiceApp({ opsToken, requireAuth: false });

    const response = await authApp.request('/api/voice/session', { method: 'POST' });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: 'MISSING_BEARER_TOKEN' });
  });
});
