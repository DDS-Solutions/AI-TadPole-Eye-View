import { describe, expect, it } from 'vitest';
import { FEMA_NFHL_ADVISORY_DISCLAIMER, FEMA_NFHL_DEFAULT_VINTAGE } from '@gev/contracts';
import {
  FEMA_NFHL_FEED_ID,
  FEMA_NFHL_PROVIDER_ID,
  FemaNfhlAdapter,
  FemaNfhlProviderDisabledError,
  FemaNfhlSeedModeViolationError,
} from '../src/index.js';

describe('FEMA NFHL Provider Adapter (PLAN.md §10 Task 11.1 & ADR 0062)', () => {
  it('initializes in seed mode by default with advisory disclaimer', () => {
    const adapter = new FemaNfhlAdapter();
    expect(adapter.isEnabled()).toBe(true);
    expect(adapter.isSeedMode()).toBe(true);
    expect(adapter.getAdvisoryDisclaimer()).toBe(FEMA_NFHL_ADVISORY_DISCLAIMER);
  });

  it('queries flood hazard features by spatial point intersection (SFHA Zone AE)', async () => {
    const adapter = new FemaNfhlAdapter();
    // Coordinates within Austin Lady Bird Lake flood hazard zone
    const features = await adapter.queryFeatures({
      point: {
        latitude: 30.263,
        longitude: -97.744,
      },
    });

    expect(features.length).toBeGreaterThanOrEqual(1);
    const lakeFeature = features.find((f) => f.fld_ar_id === '48453C_001');
    expect(lakeFeature).toBeDefined();
    expect(lakeFeature?.fld_zone).toBe('AE');
    expect(lakeFeature?.sfha_tf).toBe(true);
    expect(lakeFeature?.zone_subty).toBe('FLOODWAY');
    expect(lakeFeature?.static_bfe.status).toBe('available');
    if (lakeFeature?.static_bfe.status === 'available') {
      expect(lakeFeature.static_bfe.value).toBe(432.0);
      expect(lakeFeature.static_bfe.unit).toBe('feet');
    }
  });

  it('queries flood hazard features across bounding box intersection', async () => {
    const adapter = new FemaNfhlAdapter();
    const features = await adapter.queryFeatures({
      bounding_box: [-97.77, 30.24, -97.67, 30.3],
    });

    expect(features.length).toBeGreaterThanOrEqual(2);
    const zones = features.map((f) => f.fld_zone);
    expect(zones).toContain('AE');
    expect(zones).toContain('X');
  });

  it('generates high-risk SFHA flood summary with BFE, floodway, and advisory disclaimer', async () => {
    const adapter = new FemaNfhlAdapter();
    const summary = await adapter.getFloodSummary({
      point: {
        latitude: 30.263,
        longitude: -97.744,
      },
    });

    expect(summary.dominant_zone).toBe('AE');
    expect(summary.risk_category).toBe('high_risk_sfha');
    expect(summary.in_sfha).toBe(true);
    expect(summary.has_floodway).toBe(true);
    expect(summary.base_flood_elevation.status).toBe('available');
    if (summary.base_flood_elevation.status === 'available') {
      expect(summary.base_flood_elevation.value).toBe(432.0);
      expect(summary.base_flood_elevation.unit).toBe('feet');
    }
    expect(summary.vertical_datum).toBe('NAVD88');
    expect(summary.advisory_disclaimer).toBe(FEMA_NFHL_ADVISORY_DISCLAIMER);
    expect(summary.provenance.source.provider_id).toBe(FEMA_NFHL_PROVIDER_ID);
    expect(summary.provenance.source.feed_id).toBe(FEMA_NFHL_FEED_ID);
    expect(summary.provenance.vintage.value).toBe(FEMA_NFHL_DEFAULT_VINTAGE);
  });

  it('preserves Zone D (undetermined risk) and does NOT coerce to minimal risk', async () => {
    const adapter = new FemaNfhlAdapter();
    // Coordinates within unstudied flood hazard zone 48453C_004
    const summary = await adapter.getFloodSummary({
      point: {
        latitude: 30.45,
        longitude: -98.0,
      },
    });

    expect(summary.dominant_zone).toBe('D');
    // Non-coercion invariant: Zone D is undetermined_risk_zone_d, never minimal_risk_outside_sfha!
    expect(summary.risk_category).toBe('undetermined_risk_zone_d');
    expect(summary.in_sfha).toBe(false);
    expect(summary.base_flood_elevation.status).toBe('not_applicable');
    if (summary.base_flood_elevation.status === 'not_applicable') {
      expect(summary.base_flood_elevation.reason).toBeDefined();
    }
  });

  it('preserves absent BFEs without numeric coercion to zero elevation', async () => {
    const adapter = new FemaNfhlAdapter();
    // Query Shoal Creek Zone X (500-year moderate risk)
    const features = await adapter.queryFeatures({
      point: {
        latitude: 30.27,
        longitude: -97.7,
      },
    });

    const shoalCreek = features.find((f) => f.fld_ar_id === '48453C_002');
    expect(shoalCreek).toBeDefined();
    expect(shoalCreek?.fld_zone).toBe('X');
    expect(shoalCreek?.static_bfe.status).toBe('not_applicable');
  });

  it('returns safe non-flooded summary for point outside mapped hazard features', async () => {
    const adapter = new FemaNfhlAdapter();
    const summary = await adapter.getFloodSummary({
      point: {
        latitude: 35.0,
        longitude: -100.0,
      },
    });

    expect(summary.feature_count).toBe(0);
    expect(summary.dominant_zone).toBe('X');
    expect(summary.risk_category).toBe('minimal_risk_outside_sfha');
    expect(summary.in_sfha).toBe(false);
    expect(summary.base_flood_elevation.status).toBe('not_applicable');
  });

  it('respects kill switch when provider is disabled', async () => {
    const disabledAdapter = new FemaNfhlAdapter({ enabled: false });
    expect(disabledAdapter.isEnabled()).toBe(false);

    await expect(
      disabledAdapter.queryFeatures({
        point: { latitude: 30.263, longitude: -97.744 },
      })
    ).rejects.toThrow(FemaNfhlProviderDisabledError);
  });

  it('rejects live ArcGIS MapServer requests in seed mode without explicit authorization', async () => {
    const liveAttemptAdapter = new FemaNfhlAdapter({
      seedMode: false,
      allowLiveCalls: false,
    });

    await expect(
      liveAttemptAdapter.queryFeatures({
        point: { latitude: 30.263, longitude: -97.744 },
      })
    ).rejects.toThrow(FemaNfhlSeedModeViolationError);
  });

  it('proves p95 query latency is strictly < 25ms in seed mode (PLAN.md §10 Task 11.1)', async () => {
    const adapter = new FemaNfhlAdapter();
    const pointQuery = {
      point: { latitude: 30.263, longitude: -97.744 },
    };

    // Warm-up query
    await adapter.getFloodSummary(pointQuery);

    const iterations = 100;
    const latencies: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await adapter.getFloodSummary(pointQuery);
      latencies.push(performance.now() - start);
    }

    latencies.sort((a, b) => a - b);
    const p95Index = Math.floor(latencies.length * 0.95);
    const p95 = latencies[p95Index];

    expect(p95).toBeLessThan(25);
  });
});
