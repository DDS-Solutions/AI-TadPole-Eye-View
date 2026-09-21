import {
  OSM_COMMERCIAL_MAX_BBOX_SPAN_DEG,
  OSM_ODBL_ATTRIBUTION,
  OSM_ODBL_LEGAL_DISCLAIMER,
  OSM_ODBL_LICENSE_ID,
  type OsmCommercialQuery,
} from '@gev/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  OSM_COMMERCIAL_FEED_ID,
  OSM_COMMERCIAL_PROVIDER_ID,
  OSM_COMMERCIAL_SEED_FIXTURE_ID,
  OsmCommercialAdapter,
  OsmCommercialInvalidQueryError,
  OsmCommercialProviderDisabledError,
  OsmCommercialSeedModeViolationError,
} from '../src/index.js';

describe('OpenStreetMap Commercial Provider Adapter (PLAN.md §10 Task 9.3 & OQ-5)', () => {
  const austinDowntownBbox = {
    min_lat: 30.25,
    min_lon: -97.76,
    max_lat: 30.28,
    max_lon: -97.73,
    name: 'Austin Downtown Commercial District, TX',
  };

  it('initializes in seed mode by default with verified synthetic fixture', async () => {
    const adapter = new OsmCommercialAdapter();
    const query: OsmCommercialQuery = {
      bbox: austinDowntownBbox,
    };

    const res = await adapter.queryCommercialEnrichment(query);

    expect(res.features.length).toBeGreaterThan(0);
    expect(res.provenance.source.provider_id).toBe(OSM_COMMERCIAL_PROVIDER_ID);
    expect(res.provenance.source.feed_id).toBe(OSM_COMMERCIAL_FEED_ID);
    expect(res.provenance.mode).toBe('seed');
    expect(res.provenance.source_mode).toBe('seed');
    expect(res.provenance.fixture_id).toBe(OSM_COMMERCIAL_SEED_FIXTURE_ID);
    expect(res.provenance.license.id).toBe(OSM_ODBL_LICENSE_ID);
    expect(res.provenance.attribution).toBe(OSM_ODBL_ATTRIBUTION);
    expect(res.disclaimer).toBe(OSM_ODBL_LEGAL_DISCLAIMER);
  });

  it('filters commercial features by requested categories', async () => {
    const adapter = new OsmCommercialAdapter();

    // Query only food & beverage
    const foodRes = await adapter.queryCommercialEnrichment({
      bbox: austinDowntownBbox,
      categories: ['food_and_beverage'],
    });

    expect(foodRes.features.length).toBeGreaterThan(0);
    for (const f of foodRes.features) {
      expect(f.category).toBe('food_and_beverage');
    }
    expect(foodRes.summary.category_counts.food_and_beverage).toBe(foodRes.features.length);
    expect(foodRes.summary.category_counts.retail).toBe(0);

    // Query retail
    const retailRes = await adapter.queryCommercialEnrichment({
      bbox: austinDowntownBbox,
      categories: ['retail'],
    });

    expect(retailRes.features.length).toBeGreaterThan(0);
    for (const f of retailRes.features) {
      expect(f.category).toBe('retail');
    }
  });

  it('filters features by search term', async () => {
    const adapter = new OsmCommercialAdapter();

    const res = await adapter.queryCommercialEnrichment({
      bbox: austinDowntownBbox,
      search_term: 'coffee',
    });

    expect(res.features.length).toBeGreaterThan(0);
    const hasCoffee = res.features.some(
      (f) => f.name.toLowerCase().includes('coffee') || f.cuisine?.toLowerCase().includes('coffee')
    );
    expect(hasCoffee).toBe(true);
  });

  it('calculates commercial footprint summary and density per km²', async () => {
    const adapter = new OsmCommercialAdapter();
    const summary = await adapter.getCommercialSummary(austinDowntownBbox);

    expect(summary.total_features).toBeGreaterThan(0);
    expect(summary.area_km2).toBeGreaterThan(5);
    expect(summary.density_per_km2).toBeGreaterThan(0);
    expect(summary.top_amenities.length).toBeGreaterThan(0);
  });

  it('generates structured EconomicEvidenceRecord objects with ODbL provenance', async () => {
    const adapter = new OsmCommercialAdapter();
    const records = await adapter.getCommercialEvidence({
      bbox: austinDowntownBbox,
    });

    expect(records.length).toBeGreaterThanOrEqual(2);
    const densityRecord = records.find((r) => r.metric_id === 'commercial-poi-density');
    expect(densityRecord).toBeDefined();
    expect(densityRecord?.source_id).toBe('osm-commercial');
    expect(densityRecord?.estimate.status).toBe('available');
    expect(densityRecord?.provenance.attribution).toContain('OpenStreetMap');
    expect(densityRecord?.provenance.license.id).toBe(OSM_ODBL_LICENSE_ID);
  });

  it('enforces kill switch via GEV_OSM_COMMERCIAL_ENABLED', async () => {
    const adapter = new OsmCommercialAdapter({ enabled: false });

    await expect(
      adapter.queryCommercialEnrichment({ bbox: austinDowntownBbox })
    ).rejects.toThrowError(OsmCommercialProviderDisabledError);
  });

  it('rejects invalid query exceeding maximum bounding box span (0.5°)', async () => {
    const adapter = new OsmCommercialAdapter();
    const oversizedBbox = {
      min_lat: 30.0,
      min_lon: -97.0,
      max_lat: 30.0 + OSM_COMMERCIAL_MAX_BBOX_SPAN_DEG + 0.1,
      max_lon: -96.5,
    };

    await expect(adapter.queryCommercialEnrichment({ bbox: oversizedBbox })).rejects.toThrowError(
      OsmCommercialInvalidQueryError
    );
  });

  it('fails closed when live mode is requested without authorization', async () => {
    const adapter = new OsmCommercialAdapter({
      seedMode: false,
      allowLiveCalls: false,
    });

    await expect(
      adapter.queryCommercialEnrichment({ bbox: austinDowntownBbox })
    ).rejects.toThrowError(OsmCommercialSeedModeViolationError);
  });

  it('guarantees zero external network calls under seed mode', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const adapter = new OsmCommercialAdapter({ seedMode: true });

    await adapter.queryCommercialEnrichment({ bbox: austinDowntownBbox });
    await adapter.getCommercialEvidence({ bbox: austinDowntownBbox });
    await adapter.getFeaturesByCategory('food_and_beverage', austinDowntownBbox);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('serves repeat identical queries from in-memory cache', async () => {
    const adapter = new OsmCommercialAdapter();
    const query: OsmCommercialQuery = { bbox: austinDowntownBbox };

    const first = await adapter.queryCommercialEnrichment(query);
    const second = await adapter.queryCommercialEnrichment(query);

    expect(first).toBe(second); // exact reference equality on cache hit
  });

  it('PERFORMANCE THRESHOLD: in-memory query & extraction executes under 10ms p95', async () => {
    const adapter = new OsmCommercialAdapter();
    const query: OsmCommercialQuery = { bbox: austinDowntownBbox };

    // Warm-up
    for (let i = 0; i < 10; i++) {
      await adapter.queryCommercialEnrichment(query);
    }

    const iterations = 100;
    const durations: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await adapter.queryCommercialEnrichment(query);
      durations.push(performance.now() - start);
    }

    durations.sort((a, b) => a - b);
    const p50 = durations[Math.floor(durations.length * 0.5)] ?? 0;
    const p95 = durations[Math.floor(durations.length * 0.95)] ?? 0;

    console.log(
      `[BENCHMARK] OSM Commercial Adapter: p50=${p50.toFixed(3)}ms, p95=${p95.toFixed(3)}ms`
    );

    expect(p95).toBeLessThan(10.0);
  });
});
