import crypto from 'node:crypto';
import fs from 'node:fs';
import type { CablePackManifest } from '@gev/contracts';
import { CableCatalogResponseSchema } from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { describe, expect, it, vi } from 'vitest';
import { CableAdapter, CablePackLoader } from '../src/cables.js';

const clock = new FrozenClock(Date.parse('2026-08-30T12:00:00.000Z'));

async function seedCatalogBody(): Promise<string> {
  const seed = await new CableAdapter({ clock }).getCatalog();
  const { provenance: _provenance, ...catalog } = seed;
  return JSON.stringify({
    ...catalog,
    catalog_id: 'licensed-cables-v1',
    vintage: 'licensed-snapshot-2026-08',
  });
}

function manifestFor(body: string, override: Partial<CablePackManifest> = {}): CablePackManifest {
  return {
    schema_version: 1,
    pack_id: 'licensed-cables-v1',
    format: 'gev-cable-catalog-v1',
    download_url: 'https://licensed.example.test/gev/cables-v1.json',
    allowed_host: 'licensed.example.test',
    allowed_path_prefix: '/gev/',
    expected_sha256: crypto.createHash('sha256').update(body).digest('hex'),
    max_bytes: 2_000_000,
    timeout_ms: 5_000,
    ...override,
  };
}

function responseFor(body: string) {
  const bytes = new TextEncoder().encode(body);
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    arrayBuffer: async () => bytes.buffer as ArrayBuffer,
  };
}

describe('cable fixture and licensed-pack boundaries', () => {
  it('reads one deterministic checked-in seed fixture with required provenance and no network', async () => {
    const fetcher = vi.fn();
    const adapter = new CableAdapter({ clock });
    const catalog = CableCatalogResponseSchema.parse(await adapter.getCatalog());

    expect(fetcher).not.toHaveBeenCalled();
    expect(catalog.catalog_id).toBe('cables-synthetic-v1');
    expect(catalog.routes).toHaveLength(3);
    expect(catalog.landing_points).toHaveLength(6);
    expect(catalog.provenance).toMatchObject({
      retrieved_at: clock.iso(),
      mode: 'seed',
      source_mode: 'seed',
      fixture_id: 'cables-synthetic-v1',
      vintage: { status: 'available', value: 'procedural-fixture-2026-08-29' },
      license: { id: 'gev-synthetic-fixture-mit' },
    });
  });

  it('requires a server-configured manifest and mandatory digest before dispatch', async () => {
    const fetcher = vi.fn();
    const loader = new CablePackLoader({ clock, fetcher });

    await expect(loader.loadPack('../caller-selected')).rejects.toThrow(/not configured/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses the exact allowlisted host/path and rejects a SHA-256 mismatch', async () => {
    const body = await seedCatalogBody();
    const fetcher = vi.fn(async () => responseFor(body));
    const loader = new CablePackLoader({
      clock,
      fetcher,
      manifests: [manifestFor(body, { expected_sha256: '0'.repeat(64) })],
    });

    await expect(loader.loadPack('licensed-cables-v1')).rejects.toThrow(/SHA-256 mismatch/);
    expect(fetcher).toHaveBeenCalledWith(
      new URL('https://licensed.example.test/gev/cables-v1.json'),
      expect.objectContaining({
        allowedHosts: ['licensed.example.test'],
        allowedPaths: [{ host: 'licensed.example.test', pathPrefix: '/gev/' }],
        maxBytes: 2_000_000,
        timeoutMs: 5_000,
      })
    );
  });

  it('validates the complete pack before atomic activation and labels licensed provenance', async () => {
    const body = await seedCatalogBody();
    const loader = new CablePackLoader({
      clock,
      manifests: [manifestFor(body)],
      fetcher: async () => responseFor(body),
    });
    const adapter = new CableAdapter({ clock });
    const downloaded = CableCatalogResponseSchema.parse(
      await loader.loadPack('licensed-cables-v1')
    );

    expect(downloaded.provenance).toMatchObject({
      mode: 'download_pack',
      source_mode: 'download_pack',
      fixture_id: null,
      license: { id: 'telegeography-commercial-data-license' },
      vintage: { status: 'available', value: 'licensed-snapshot-2026-08' },
    });
    adapter.activatePack('licensed-cables-v1', downloaded);
    expect((await adapter.getCatalog()).provenance.mode).toBe('download_pack');
  });

  it('rejects malformed pack content without changing the last valid seed state', async () => {
    const body = JSON.stringify({
      type: 'FeatureCollection',
      features: [{ geometry: { type: 'LineString', coordinates: [[181, 91]] } }],
    });
    const adapter = new CableAdapter({ clock });
    const loader = new CablePackLoader({
      clock,
      manifests: [manifestFor(body)],
      fetcher: async () => responseFor(body),
    });

    await expect(loader.loadPack('licensed-cables-v1')).rejects.toThrow();
    expect(adapter.getMode()).toBe('seed');
    expect((await adapter.getCatalog()).provenance.mode).toBe('seed');
    expect(() =>
      adapter.activatePack('licensed-cables-v1', { catalog_id: 'missing-provenance' })
    ).toThrow();
  });

  it('applies the kill switch before seed file or pack network dispatch', async () => {
    const readSpy = vi.spyOn(fs.promises, 'readFile');
    const fetcher = vi.fn();
    const adapter = new CableAdapter({ clock, enabled: false });
    const loader = new CablePackLoader({ clock, enabled: false, fetcher });
    try {
      await expect(adapter.getCatalog()).rejects.toThrow(/kill switch/);
      await expect(loader.loadPack('anything')).rejects.toThrow(/kill switch/);
      expect(readSpy).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      readSpy.mockRestore();
    }
  });
});
