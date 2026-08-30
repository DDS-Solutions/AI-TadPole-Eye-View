import { describe, expect, it } from 'vitest';
import {
  CableCatalogSchema,
  CablePackManifestSchema,
  MAX_CABLE_COORDINATES,
} from '../src/index.js';

const validCatalog = {
  schema_version: 1,
  catalog_id: 'cables-test-v1',
  observed_at: '2026-08-29T00:00:00.000Z',
  vintage: 'test-v1',
  landing_points: [
    { id: 'landing-a', name: 'Landing A', country: 'Fixture', longitude: -70, latitude: 40 },
    { id: 'landing-b', name: 'Landing B', country: 'Fixture', longitude: 5, latitude: 50 },
  ],
  routes: [
    {
      id: 'route-a',
      name: 'Route A',
      status: 'active',
      owners: ['Fixture operator'],
      rfs_year: 2026,
      length_km: 5_000,
      landing_point_ids: ['landing-a', 'landing-b'],
      segments: [
        [
          [-70, 40],
          [5, 50],
        ],
      ],
    },
  ],
} as const;

describe('cable contracts', () => {
  it('validates a bounded catalog with referentially complete landing points', () => {
    expect(CableCatalogSchema.parse(validCatalog).routes).toHaveLength(1);
  });

  it('rejects unknown landing points, duplicate identifiers, and invalid coordinates', () => {
    expect(() =>
      CableCatalogSchema.parse({
        ...validCatalog,
        landing_points: [validCatalog.landing_points[0], validCatalog.landing_points[0]],
        routes: [
          {
            ...validCatalog.routes[0],
            landing_point_ids: ['landing-a', 'traversal-like-id'],
            segments: [
              [
                [181, 40],
                [5, 50],
              ],
            ],
          },
        ],
      })
    ).toThrow();
  });

  it('enforces a catalog-wide coordinate bound', () => {
    const segments = Array.from({ length: 25 }, () =>
      Array.from({ length: 4_001 }, (_, index) => [index % 180, index % 90] as [number, number])
    );
    expect(segments.reduce((total, segment) => total + segment.length, 0)).toBeGreaterThan(
      MAX_CABLE_COORDINATES
    );
    expect(() =>
      CableCatalogSchema.parse({
        ...validCatalog,
        routes: [{ ...validCatalog.routes[0], segments }],
      })
    ).toThrow(/total coordinates/);
  });

  it('confines trusted pack manifests to an exact HTTPS host and path', () => {
    const manifest = {
      schema_version: 1,
      pack_id: 'licensed-pack-v1',
      format: 'gev-cable-catalog-v1',
      download_url: 'https://licensed.example.test/gev/cables-v1.json',
      allowed_host: 'licensed.example.test',
      allowed_path_prefix: '/gev/',
      expected_sha256: 'a'.repeat(64),
      max_bytes: 2_000_000,
      timeout_ms: 5_000,
    };

    expect(CablePackManifestSchema.parse(manifest).pack_id).toBe('licensed-pack-v1');
    expect(() =>
      CablePackManifestSchema.parse({
        ...manifest,
        download_url: 'https://attacker.example/gev/cables-v1.json',
      })
    ).toThrow(/host/);
    expect(() => CablePackManifestSchema.parse({ ...manifest, expected_sha256: '' })).toThrow();
  });
});
