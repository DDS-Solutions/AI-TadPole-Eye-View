import crypto from 'node:crypto';
import { CableCatalogResponseSchema, ProviderFeedHealthResponseSchema } from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { PromptApprovalGate, createGovernanceRuntimeContext } from '@gev/governance';
import { CableAdapter } from '@gev/providers';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/index.js';

const clock = new FrozenClock(Date.parse('2026-08-30T12:00:00.000Z'));

async function licensedBody(): Promise<string> {
  const seed = await new CableAdapter({ clock }).getCatalog();
  const { provenance: _provenance, ...catalog } = seed;
  return JSON.stringify({
    ...catalog,
    catalog_id: 'licensed-cables-v1',
    vintage: 'licensed-snapshot-2026-08',
  });
}

function packManifest(body: string, expectedSha256?: string) {
  return {
    schema_version: 1 as const,
    pack_id: 'licensed-cables-v1',
    format: 'gev-cable-catalog-v1' as const,
    download_url: 'https://licensed.example.test/gev/cables-v1.json',
    allowed_host: 'licensed.example.test',
    allowed_path_prefix: '/gev/',
    expected_sha256:
      expectedSha256 ?? crypto.createHash('sha256').update(body, 'utf8').digest('hex'),
    max_bytes: 2_000_000,
    timeout_ms: 5_000,
  };
}

function fetcherFor(body: string) {
  const bytes = new TextEncoder().encode(body);
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    arrayBuffer: async () => bytes.buffer as ArrayBuffer,
  }));
}

describe('cable server, cache, kill switch, and governed pack activation', () => {
  it('serves a bounded validated seed catalog and registry-derived cache TTL', async () => {
    const runtime = createGovernanceRuntimeContext({ clock, dbPath: ':memory:' });
    try {
      const { app, providerRegistry } = createApp({ clock, governanceContext: runtime });
      const firstResponse = await app.request('/api/cables');
      const first = CableCatalogResponseSchema.parse(await firstResponse.json());
      const secondResponse = await app.request('/api/cables');
      const second = CableCatalogResponseSchema.parse(await secondResponse.json());

      expect(firstResponse.status).toBe(200);
      expect(first.routes).toHaveLength(3);
      expect(first.provenance.mode).toBe('seed');
      expect(secondResponse.headers.get('X-GEV-Cache')).toBe('HIT');
      expect(secondResponse.headers.get('X-GEV-TTL-Sec')).toBe('86400');
      expect(second.provenance).toMatchObject({ mode: 'cached', source_mode: 'seed' });
      expect(
        providerRegistry.providers.find((provider) => provider.id === 'submarine-cables')
      ).toMatchObject({
        mode: 'seed',
        health: 'healthy',
        source: { license_id: 'gev-synthetic-fixture-mit' },
      });
    } finally {
      runtime.close();
    }
  });

  it('reports a truthful degraded registry and refuses catalog reads when disabled', async () => {
    const runtime = createGovernanceRuntimeContext({ clock, dbPath: ':memory:' });
    try {
      const { app } = createApp({ clock, governanceContext: runtime, cablesEnabled: false });
      const response = await app.request('/api/cables');
      const health = ProviderFeedHealthResponseSchema.parse(
        await (await app.request('/api/feeds/health')).json()
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({ code: 'PROVIDER_DISABLED' });
      expect(health.feeds.find((feed) => feed.id === 'cables')).toMatchObject({
        mode: 'seed',
        status: 'degraded',
      });
    } finally {
      runtime.close();
    }
  });

  it('requires authenticated human approval before download dispatch', async () => {
    const body = await licensedBody();
    const fetcher = fetcherFor(body);
    const runtime = createGovernanceRuntimeContext({
      clock,
      dbPath: ':memory:',
      approvalGate: new PromptApprovalGate({ policy: 'deny', clock }),
    });
    try {
      const { app } = createApp({
        clock,
        governanceContext: runtime,
        opsAuth: { opsToken: 'operator-token', requireAuth: true },
        cablePackManifests: [packManifest(body)],
        cablePackFetcher: fetcher,
      });
      const unauthorized = await app.request('/ops/cables/packs/activate', {
        method: 'POST',
        body: JSON.stringify({ pack_id: 'licensed-cables-v1' }),
      });
      const denied = await app.request('/ops/cables/packs/activate', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer operator-token',
          'Content-Type': 'application/json',
          'Idempotency-Key': '00000000-0000-4000-8000-000000000522',
        },
        body: JSON.stringify({ pack_id: 'licensed-cables-v1' }),
      });

      expect(unauthorized.status).toBe(401);
      expect(denied.status).toBe(403);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      runtime.close();
    }
  });

  it('atomically activates a digest-pinned pack, invalidates seed cache, and updates registry truth', async () => {
    const body = await licensedBody();
    const fetcher = fetcherFor(body);
    const runtime = createGovernanceRuntimeContext({ clock, dbPath: ':memory:' });
    try {
      const server = createApp({
        clock,
        governanceContext: runtime,
        opsAuth: { opsToken: 'operator-token', requireAuth: true },
        cablePackManifests: [packManifest(body)],
        cablePackFetcher: fetcher,
      });
      expect((await server.app.request('/api/cables')).status).toBe(200);
      const activation = await server.app.request('/ops/cables/packs/activate', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer operator-token',
          'Content-Type': 'application/json',
          'Idempotency-Key': '00000000-0000-4000-8000-000000000523',
          'X-Task-Ref': 'test-cable-pack-activation',
        },
        body: JSON.stringify({ pack_id: 'licensed-cables-v1' }),
      });
      const activeCatalogResponse = await server.app.request('/api/cables');
      const activeCatalog = CableCatalogResponseSchema.parse(await activeCatalogResponse.json());

      expect(activation.status).toBe(200);
      await expect(activation.json()).resolves.toMatchObject({
        activated: true,
        pack_id: 'licensed-cables-v1',
        mode: 'download_pack',
        route_count: 3,
        landing_point_count: 6,
      });
      expect(activeCatalogResponse.headers.get('X-GEV-Cache')).toBe('MISS');
      expect(activeCatalog.provenance).toMatchObject({
        mode: 'download_pack',
        source_mode: 'download_pack',
        license: { id: 'telegeography-commercial-data-license' },
      });
      expect(
        server.providerRegistry.providers.find((provider) => provider.id === 'submarine-cables')
      ).toMatchObject({
        mode: 'download_pack',
        health: 'healthy',
        source: { license_id: 'telegeography-commercial-data-license' },
      });
      expect(runtime.auditSink.tailByTaskRef('test-cable-pack-activation')).toHaveLength(2);
    } finally {
      runtime.close();
    }
  });

  it('keeps seed mode and truthful health when pack integrity fails', async () => {
    const body = await licensedBody();
    const runtime = createGovernanceRuntimeContext({ clock, dbPath: ':memory:' });
    try {
      const server = createApp({
        clock,
        governanceContext: runtime,
        opsAuth: { opsToken: 'operator-token', requireAuth: true },
        cablePackManifests: [packManifest(body, '0'.repeat(64))],
        cablePackFetcher: fetcherFor(body),
      });
      const activation = await server.app.request('/ops/cables/packs/activate', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer operator-token',
          'Content-Type': 'application/json',
          'Idempotency-Key': '00000000-0000-4000-8000-000000000524',
        },
        body: JSON.stringify({ pack_id: 'licensed-cables-v1' }),
      });

      expect(activation.status).toBe(422);
      expect(server.adapters.cables.getMode()).toBe('seed');
      expect(
        server.providerRegistry.providers.find((provider) => provider.id === 'submarine-cables')
      ).toMatchObject({
        mode: 'seed',
        health: 'healthy',
      });
    } finally {
      runtime.close();
    }
  });
});
