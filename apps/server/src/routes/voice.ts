import crypto from 'node:crypto';
import { VoiceSessionRequest } from '@gev/contracts';
import type { SimClock } from '@gev/core';
import { SystemClock } from '@gev/core';
import { pinnedFetch } from '@gev/security';
import { Hono } from 'hono';
import type { OpsAuthAdapter } from '../middleware/opsAuth.js';

export interface VoiceRouterOptions {
  auth: OpsAuthAdapter;
  clock?: SimClock;
  apiKey?: string;
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

    // In seed / mock / dev mode without live OpenAI key
    if (!apiKey || apiKey === 'mock_key' || process.env.GEV_SEED_MODE === '1') {
      const nowSec = Math.floor(clock.now() / 1000);
      return c.json({
        client_secret: `ek_mock_dev_${crypto.randomUUID().replace(/-/g, '')}`,
        expires_at: nowSec + 3600,
        model: reqData.model,
        session_id: `sess_${crypto.randomUUID().slice(0, 12)}`,
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
        const errText = await res.text();
        throw new Error(`OpenAI API returned HTTP ${res.status}: ${errText}`);
      }

      const json = (await res.json()) as {
        client_secret?: { value: string; expires_at: number };
        id?: string;
        model?: string;
      };

      return c.json({
        client_secret: json.client_secret?.value || `ek_live_${crypto.randomUUID()}`,
        expires_at: json.client_secret?.expires_at || Math.floor(clock.now() / 1000) + 60,
        model: json.model || reqData.model,
        session_id: json.id || `sess_${crypto.randomUUID()}`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown OpenAI error';
      return c.json({ error: message }, 502);
    }
  });

  return router;
}
