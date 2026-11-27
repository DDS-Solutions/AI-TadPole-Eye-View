import crypto from 'node:crypto';
import { type AuditSink, GevEvents, VoiceSessionRequest } from '@gev/contracts';
import type { SimClock } from '@gev/core';
import { SystemClock } from '@gev/core';
import { pinnedFetch } from '@gev/security';
import { Hono } from 'hono';
import {
  type InMemoryRateLimiter,
  type OpsAuthAdapter,
  createRateLimitMiddleware,
} from '../middleware/opsAuth.js';

export interface VoiceRouterOptions {
  auth: OpsAuthAdapter;
  clock?: SimClock;
  apiKey?: string;
  auditSink?: AuditSink;
  stasisActive?: () => boolean;
  rateLimiter?: InMemoryRateLimiter;
  resolveClientId?: Parameters<typeof createRateLimitMiddleware>[1]['resolveClientId'];
}

/**
 * OpenAI Realtime Ephemeral Token Route (PLAN.md §10 Phase 1 Item 6)
 * Issues client-side ephemeral `ek_...` session tokens with auth-default guard.
 */
export function createVoiceRouter(options: VoiceRouterOptions) {
  const router = new Hono();
  const clock = options.clock ?? new SystemClock();
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  router.use('*', options.auth.middleware());
  if (options.rateLimiter && options.resolveClientId) {
    router.use(
      '/session',
      createRateLimitMiddleware(options.rateLimiter, {
        bucket: 'voice-session',
        limit: 5,
        resolveClientId: options.resolveClientId,
      })
    );
  }

  router.post('/session', async (c) => {
    let body: unknown = {};
    try {
      body = await c.req.json();
    } catch {
      // Allow empty JSON for default settings
    }

    const parsed = VoiceSessionRequest.safeParse(body);
    const reqData = parsed.success
      ? parsed.data
      : {
          model: 'gpt-4o-realtime-preview' as const,
          voice: 'alloy' as const,
          modalities: ['text', 'audio'] as const,
        };

    const startedAt = clock.now();
    const intentId = crypto.randomUUID();
    const rawActor = c.get('opsActor' as never) as string | undefined;
    const actor: 'ai' | 'human' | 'system' =
      rawActor === 'ai' || rawActor === 'human' || rawActor === 'system' ? rawActor : 'human';
    const tenantId = (c.get('opsTenantId' as never) as string | undefined) ?? 'tenant-local';

    options.auditSink?.intent({
      kind: GevEvents.AuditIntent,
      id: intentId,
      ts: new Date(startedAt).toISOString(),
      actor,
      action: 'voice.session.create',
      target: 'openai-realtime',
      params: { model: reqData.model, voice: reqData.voice, tenant_id: tenantId },
      task_ref: 'voice-session',
    });

    const recordOutcome = (status: 'ok' | 'error' | 'blocked', error?: string) => {
      options.auditSink?.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: new Date(clock.now()).toISOString(),
        status,
        duration_ms: Math.max(0, clock.now() - startedAt),
        ...(error ? { error } : {}),
      });
    };

    if (options.stasisActive?.()) {
      recordOutcome('blocked', 'STASIS_ACTIVE');
      return c.json(
        { error: 'Voice sessions are suspended while STASIS is active', code: 'STASIS_ACTIVE' },
        423
      );
    }

    const isSeedMode = process.env.GEV_SEED_MODE === '1';
    const isProduction = process.env.NODE_ENV === 'production';

    if (!isSeedMode && isProduction && (!apiKey || apiKey === 'mock_key')) {
      recordOutcome('error', 'VOICE_NOT_CONFIGURED');
      return c.json(
        {
          error: 'Voice provider API key is not configured for production mode',
          code: 'VOICE_NOT_CONFIGURED',
        },
        503
      );
    }

    // In explicit seed / mock / non-production dev mode without live OpenAI key
    if (isSeedMode || !apiKey || apiKey === 'mock_key') {
      const nowSec = Math.floor(clock.now() / 1000);
      const sessionId = `sess_${crypto.randomUUID().slice(0, 12)}`;
      recordOutcome('ok');
      return c.json({
        client_secret: `ek_mock_dev_${crypto.randomUUID().replace(/-/g, '')}`,
        expires_at: nowSec + 3600,
        model: reqData.model,
        session_id: sessionId,
      });
    }

    // Live mode: call OpenAI Realtime session endpoint
    try {
      const url = new URL('https://api.openai.com/v1/realtime/sessions');
      const res = await pinnedFetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: reqData.model,
          voice: reqData.voice,
        }),
        allowedHosts: ['api.openai.com'],
        timeoutMs: 10000,
      });

      if (!res.ok) {
        recordOutcome('error', `Upstream HTTP ${res.status}`);
        return c.json(
          { error: 'Upstream voice provider error', code: 'VOICE_PROVIDER_ERROR' },
          502
        );
      }

      const json = (await res.json()) as {
        client_secret?: { value: string; expires_at: number };
        id?: string;
        model?: string;
      };

      recordOutcome('ok');
      return c.json({
        client_secret: json.client_secret?.value || `ek_live_${crypto.randomUUID()}`,
        expires_at: json.client_secret?.expires_at || Math.floor(clock.now() / 1000) + 60,
        model: json.model || reqData.model,
        session_id: json.id || `sess_${crypto.randomUUID()}`,
      });
    } catch {
      recordOutcome('error', 'VOICE_PROVIDER_ERROR');
      return c.json({ error: 'Upstream voice provider error', code: 'VOICE_PROVIDER_ERROR' }, 502);
    }
  });

  return router;
}
