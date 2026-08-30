import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  type CableCatalog,
  CableCatalogResponseSchema,
  CableCatalogSchema,
  type CablePackManifest,
  CablePackManifestSchema,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import { type PinnedFetchOptions, pinnedFetch } from '@gev/security';
import { resolveFixturePath } from './opensky.js';
import { createDataProvenance, observationPeriodFromIso } from './provenance.js';

const CABLE_PROVIDER_ID = 'submarine-cables';
const CABLE_FEED_ID = 'cables';
const CABLE_SEED_FIXTURE_ID = 'cables-synthetic-v1';

export class CableProviderDisabledError extends Error {
  constructor() {
    super('Submarine cable provider is disabled by the GEV_CABLES_ENABLED kill switch');
  }
}

interface CablePackFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type CablePackFetcher = (
  target: URL,
  options: PinnedFetchOptions
) => Promise<CablePackFetchResponse>;

export interface CableAdapterOptions {
  clock?: SimClock;
  seedFixturePath?: string;
  enabled?: boolean;
}

export interface CablePackLoaderOptions {
  clock?: SimClock;
  enabled?: boolean;
  manifests?: readonly CablePackManifest[];
  fetcher?: CablePackFetcher;
}

function createCableResponse(
  catalogInput: unknown,
  clock: SimClock,
  sourceMode: 'seed' | 'download_pack'
) {
  const catalog = CableCatalogSchema.parse(catalogInput);
  return CableCatalogResponseSchema.parse({
    ...catalog,
    provenance: createDataProvenance({
      providerId: CABLE_PROVIDER_ID,
      feedId: CABLE_FEED_ID,
      clock,
      sourceMode,
      observationPeriod: observationPeriodFromIso(catalog.observed_at),
      vintage: { status: 'available', value: catalog.vintage },
      ...(sourceMode === 'seed' ? { fixtureId: CABLE_SEED_FIXTURE_ID } : {}),
    }),
  });
}

/** Reads the one checked-in procedural cable fixture or the last atomically activated pack. */
export class CableAdapter {
  private readonly clock: SimClock;
  private readonly seedFixturePath: string;
  private readonly enabled: boolean;
  private cachedSeedCatalog: CableCatalog | null = null;
  private activePackCatalog: CableCatalog | null = null;
  private activePackId: string | null = null;

  constructor(options: CableAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.seedFixturePath =
      options.seedFixturePath ?? resolveFixturePath('cables-synthetic-v1.json');
    this.enabled = options.enabled ?? process.env.GEV_CABLES_ENABLED !== '0';
  }

  getMode(): 'seed' | 'download_pack' {
    return this.activePackCatalog ? 'download_pack' : 'seed';
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getActivePackId(): string | null {
    return this.activePackId;
  }

  async getCatalog() {
    this.assertEnabled();
    const sourceMode = this.getMode();
    const catalog = this.activePackCatalog ?? (await this.loadSeedCatalog());
    return createCableResponse(catalog, this.clock, sourceMode);
  }

  activatePack(packId: string, responseInput: unknown): void {
    this.assertEnabled();
    const response = CableCatalogResponseSchema.parse(responseInput);
    if (response.provenance.source_mode !== 'download_pack') {
      throw new Error('Only a validated download-pack response can be activated');
    }
    const { provenance: _provenance, ...catalog } = response;
    this.activePackCatalog = CableCatalogSchema.parse(catalog);
    this.activePackId = packId;
  }

  private async loadSeedCatalog(): Promise<CableCatalog> {
    if (this.cachedSeedCatalog) {
      return this.cachedSeedCatalog;
    }
    const raw = await fs.promises.readFile(this.seedFixturePath, 'utf8');
    this.cachedSeedCatalog = CableCatalogSchema.parse(JSON.parse(raw));
    return this.cachedSeedCatalog;
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new CableProviderDisabledError();
    }
  }
}

/** Downloads only server-configured, digest-pinned licensed packs; no caller URL is accepted. */
export class CablePackLoader {
  private readonly clock: SimClock;
  private readonly enabled: boolean;
  private readonly manifests = new Map<string, CablePackManifest>();
  private readonly fetcher: CablePackFetcher;

  constructor(options: CablePackLoaderOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.enabled = options.enabled ?? process.env.GEV_CABLES_ENABLED !== '0';
    this.fetcher = options.fetcher ?? ((target, fetchOptions) => pinnedFetch(target, fetchOptions));
    for (const manifestInput of options.manifests ?? []) {
      const manifest = CablePackManifestSchema.parse(manifestInput);
      if (this.manifests.has(manifest.pack_id)) {
        throw new Error(`Duplicate cable pack manifest '${manifest.pack_id}'`);
      }
      this.manifests.set(manifest.pack_id, manifest);
    }
  }

  hasPack(packId: string): boolean {
    return this.manifests.has(packId);
  }

  async loadPack(packId: string) {
    if (!this.enabled) {
      throw new CableProviderDisabledError();
    }
    const manifest = this.manifests.get(packId);
    if (!manifest) {
      throw new Error(`Cable download pack '${packId}' is not configured on this server`);
    }

    const url = new URL(manifest.download_url);
    const response = await this.fetcher(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'GEV-Cable-Pack-Loader/2.0' },
      allowedHosts: [manifest.allowed_host],
      allowedPaths: [{ host: manifest.allowed_host, pathPrefix: manifest.allowed_path_prefix }],
      timeoutMs: manifest.timeout_ms,
      maxBytes: manifest.max_bytes,
    });
    if (!response.ok) {
      throw new Error(`Cable pack returned HTTP ${response.status}: ${response.statusText}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > manifest.max_bytes) {
      throw new Error(`Cable pack exceeds the configured ${manifest.max_bytes}-byte limit`);
    }
    const actualSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    if (actualSha256 !== manifest.expected_sha256) {
      throw new Error('Cable pack integrity check failed: SHA-256 mismatch');
    }

    const catalog = CableCatalogSchema.parse(JSON.parse(bytes.toString('utf8')));
    return createCableResponse(catalog, this.clock, 'download_pack');
  }
}
