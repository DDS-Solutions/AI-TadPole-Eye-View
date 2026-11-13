import { GEV_PRODUCTION_IDENTITY_PROFILE } from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { SqliteAuditSink } from '@gev/governance';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type OpsAuthOptions, createOpsAuth } from '../src/middleware/opsAuth.js';
import { createVoiceRouter } from '../src/routes/voice.js';

describe('Voice Realtime Session Token Route (PLAN.md §10 Phase 1 Item 6)', () => {
  const opsToken = 'test_secret_token_123';
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  function createVoiceApp(
    authOptions: OpsAuthOptions,
    extra?: { stasisActive?: () => boolean; auditSink?: SqliteAuditSink; apiKey?: string }
  ) {
    const app = new Hono();
    const auth = createOpsAuth(authOptions);
    app.route(
      '/api/voice',
      createVoiceRouter({
        auth,
        apiKey: extra?.apiKey ?? 'mock_key',
        stasisActive: extra?.stasisActive,
        auditSink: extra?.auditSink,
      })
    );
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
    expect(data.error).toContain('identity verification is not configured');
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

  it('blocks /api/voice/session under STASIS with 423 and records audit intent + blocked outcome', async () => {
    const clock = new FrozenClock(1_731_400_000_000);
    const auditSink = new SqliteAuditSink({ dbPath: ':memory:', clock });
    cleanups.push(() => auditSink.close());
    const authApp = createVoiceApp(
      { opsToken, requireAuth: true },
      { stasisActive: () => true, auditSink }
    );

    const res = await authApp.request('/api/voice/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opsToken}`,
      },
      body: JSON.stringify({ model: 'gpt-4o-realtime-preview' }),
    });

    expect(res.status).toBe(423);
    await expect(res.json()).resolves.toMatchObject({ code: 'STASIS_ACTIVE' });
    const events = auditSink.tail({ limit: 10 });
    expect(events.map((e) => e.kind)).toEqual(['audit.intent', 'audit.outcome']);
    expect(events[1]).toMatchObject({ status: 'blocked', error: 'STASIS_ACTIVE' });
  });

  it('fails closed in production when OPENAI_API_KEY is missing/mock and seed mode is off', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('GEV_SEED_MODE', '0');
    const clock = new FrozenClock(1_731_400_000_000);
    const nowSec = Math.floor(clock.now() / 1000);
    const authApp = createVoiceApp({
      requireAuth: true,
      clock,
      bearerVerifier: {
        verify: async ({ access_token }) =>
          access_token === 'prod-token'
            ? {
                actor: 'human',
                principal: 'auth0|prod-op',
                tenant_id: 'tenant-prod',
                role: 'operator',
                client_id: 'gev-web',
                token_id: 'tok-prod',
                issuer: GEV_PRODUCTION_IDENTITY_PROFILE.issuer,
                audience: GEV_PRODUCTION_IDENTITY_PROFILE.rest_resource,
                resource: GEV_PRODUCTION_IDENTITY_PROFILE.rest_resource,
                scopes: ['read.telemetry'],
                issued_at_epoch_seconds: nowSec - 10,
                not_before_epoch_seconds: nowSec - 10,
                expires_at_epoch_seconds: nowSec + 290,
              }
            : null,
      },
    });

    const res = await authApp.request('/api/voice/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer prod-token',
      },
      body: '{}',
    });

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ code: 'VOICE_NOT_CONFIGURED' });
  });
});
