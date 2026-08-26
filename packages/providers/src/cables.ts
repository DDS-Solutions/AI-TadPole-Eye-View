import crypto from 'node:crypto';
import { pinnedFetch } from '@gev/security';

export interface CableLandingPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  country: string;
}

export interface SubmarineCable {
  id: string;
  name: string;
  owners?: string;
  rfs_year?: number;
  length_km?: number;
  color?: string;
  landing_points: CableLandingPoint[];
  coordinates: [number, number][][]; // MultiLineString array of [lon, lat]
}

export interface CableCatalog {
  cables: SubmarineCable[];
  source: 'download_pack' | 'synthetic_seed';
  license: string;
  timestamp: number;
}

export interface CableDownloadOptions {
  licenseAccepted: boolean;
  packUrl?: string;
  expectedSha256?: string;
  timeoutMs?: number;
}

/**
 * Submarine Cable Pack Loader (PLAN.md §5 & §10 Phase 4)
 * Enforces zero-bundling policy for non-commercial (CC BY-NC-SA) TeleGeography data
/**
 * Generates a clean synthetic cable topology for seed/airgap mode with zero NC encumbrance.
 */
export function loadSyntheticCablePack(): CableCatalog {
  return {
    cables: [
      {
        id: 'cable-transatlantic-1',
        name: 'Synthetic Transatlantic Route Alpha',
        owners: 'Open Consortium',
        rfs_year: 2024,
        length_km: 6600,
        color: '#00ffff',
        landing_points: [
          {
            id: 'lp-bude',
            name: 'Bude Station',
            latitude: 50.83,
            longitude: -4.54,
            country: 'United Kingdom',
          },
          {
            id: 'lp-ny',
            name: 'Shirley Landing Point',
            latitude: 40.8,
            longitude: -72.87,
            country: 'United States',
          },
        ],
        coordinates: [
          [
            [-4.54, 50.83],
            [-15.0, 52.0],
            [-30.0, 50.0],
            [-45.0, 45.0],
            [-60.0, 42.0],
            [-72.87, 40.8],
          ],
        ],
      },
      {
        id: 'cable-transpacific-1',
        name: 'Synthetic Transpacific Route Beta',
        owners: 'Pacific Transit Group',
        rfs_year: 2023,
        length_km: 9800,
        color: '#ff00ff',
        landing_points: [
          {
            id: 'lp-tokyo',
            name: 'Chiba Station',
            latitude: 35.6,
            longitude: 140.1,
            country: 'Japan',
          },
          {
            id: 'lp-oregon',
            name: 'Pacific City',
            latitude: 45.2,
            longitude: -123.96,
            country: 'United States',
          },
        ],
        coordinates: [
          [
            [140.1, 35.6],
            [160.0, 40.0],
            [180.0, 45.0],
            [-160.0, 47.0],
            [-140.0, 46.0],
            [-123.96, 45.2],
          ],
        ],
      },
      {
        id: 'cable-suez-1',
        name: 'Synthetic Mediterranean-Red Sea Route',
        owners: 'Eurasia Gateway',
        rfs_year: 2022,
        length_km: 4200,
        color: '#ffff00',
        landing_points: [
          {
            id: 'lp-marseille',
            name: 'Marseille Hub',
            latitude: 43.3,
            longitude: 5.37,
            country: 'France',
          },
          {
            id: 'lp-alexandria',
            name: 'Abu Talat',
            latitude: 31.1,
            longitude: 29.8,
            country: 'Egypt',
          },
          {
            id: 'lp-djibouti',
            name: 'Djibouti City',
            latitude: 11.6,
            longitude: 43.15,
            country: 'Djibouti',
          },
        ],
        coordinates: [
          [
            [5.37, 43.3],
            [15.0, 36.0],
            [25.0, 33.0],
            [29.8, 31.1],
          ],
          [
            [32.5, 29.9],
            [35.0, 25.0],
            [40.0, 18.0],
            [43.15, 11.6],
          ],
        ],
      },
    ],
    source: 'synthetic_seed',
    license: 'MIT / CC0 (Procedural Synthetic Topology)',
    timestamp: Date.now(),
  };
}

/**
 * Downloads official TeleGeography cable pack, strictly requiring explicit license agreement.
 */
export async function downloadCablePack(options: CableDownloadOptions): Promise<CableCatalog> {
  if (!options.licenseAccepted) {
    throw new Error(
      'TeleGeography cable data requires explicit runtime license agreement (CC BY-NC-SA 4.0). Pass { licenseAccepted: true } to proceed.'
    );
  }

  const packUrl =
    options.packUrl ??
    'https://raw.githubusercontent.com/telegeography/www.submarinecablemap.com/master/web/public/api/v3/cable/cable-geo.json';

  const url = new URL(packUrl);
  const res = await pinnedFetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'GEV-Cable-Pack-Loader/1.0',
    },
    allowedHosts: ['raw.githubusercontent.com', 'github.com', 'submarinecablemap.com'],
    timeoutMs: options.timeoutMs ?? 15000,
    maxBytes: 25 * 1024 * 1024, // 25 MB cap
  });

  const rawBuffer = await res.arrayBuffer();
  const rawText = Buffer.from(rawBuffer).toString('utf-8');

  if (options.expectedSha256) {
    const computedHash = crypto.createHash('sha256').update(rawText).digest('hex');
    if (computedHash !== options.expectedSha256) {
      throw new Error(
        `Cable pack integrity check failed: expected SHA-256 ${options.expectedSha256}, got ${computedHash}`
      );
    }
  }

  const parsedGeoJson = JSON.parse(rawText) as {
    type: string;
    features: Array<{
      properties: {
        id: string;
        name: string;
        owners?: string;
        rfs?: string;
        length?: string;
        color?: string;
      };
      geometry: {
        type: string;
        coordinates: [number, number][][] | [number, number][];
      };
    }>;
  };

  const cables: SubmarineCable[] = (parsedGeoJson.features || []).map((f) => {
    const coords =
      f.geometry.type === 'MultiLineString'
        ? (f.geometry.coordinates as [number, number][][])
        : f.geometry.type === 'LineString'
          ? [f.geometry.coordinates as [number, number][]]
          : [];

    return {
      id: String(f.properties.id || crypto.randomUUID()),
      name: f.properties.name || 'Unnamed Submarine Cable',
      owners: f.properties.owners,
      rfs_year: f.properties.rfs ? Number.parseInt(f.properties.rfs, 10) : undefined,
      length_km: f.properties.length
        ? Number.parseFloat(f.properties.length.replace(/[^0-9.]/g, ''))
        : undefined,
      color: f.properties.color || '#00e5ff',
      landing_points: [],
      coordinates: coords,
    };
  });

  return {
    cables,
    source: 'download_pack',
    license: 'Creative Commons Attribution-NonCommercial-ShareAlike 4.0 (CC BY-NC-SA 4.0)',
    timestamp: Date.now(),
  };
}

/**
 * Submarine Cable Pack Loader instance helper (PLAN.md §5 & §10 Phase 4).
 */
export class CablePackLoader {
  private readonly defaultOptions: CableDownloadOptions;

  constructor(defaultOptions: Partial<CableDownloadOptions> = {}) {
    this.defaultOptions = {
      licenseAccepted: defaultOptions.licenseAccepted ?? false,
      packUrl: defaultOptions.packUrl,
      expectedSha256: defaultOptions.expectedSha256,
      timeoutMs: defaultOptions.timeoutMs,
    };
  }

  loadSyntheticSeedPack(): CableCatalog {
    return loadSyntheticCablePack();
  }

  async downloadPack(overrideOptions?: Partial<CableDownloadOptions>): Promise<CableCatalog> {
    return downloadCablePack({
      ...this.defaultOptions,
      ...overrideOptions,
    });
  }
}
