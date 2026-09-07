import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LayerAccessReadModelSchema,
  type LayerAccessRuntimeSnapshot,
  type OperationalAoi,
  type ProviderRegistry,
  ProviderRegistrySchema,
  filterLayerAccessEntries,
} from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { describe, expect, it } from 'vitest';
import { parseAviationWeather } from '../src/aviationWeather.js';
import { parseCoastalConditions } from '../src/coastalConditions.js';
import { createLayerAccessReadModel } from '../src/layerAccessProjection.js';
import { parseNwsAlerts } from '../src/nwsAlerts.js';
import { createProviderRegistry } from '../src/registry.js';
import { parseNhcGisIndex } from '../src/tropicalCyclones.js';

const referenceMs = Date.parse('2024-08-25T10:00:00.000Z');
const conus: OperationalAoi = { min_lat: 24, max_lat: 50, min_lon: -125, max_lon: -66 };
const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures');

function fixture(name: string): { type: 'FeatureCollection'; features: unknown[] } {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), 'utf8')) as {
    type: 'FeatureCollection';
    features: unknown[];
  };
}

function expandProduct(
  payload: { type: 'FeatureCollection'; features: unknown[] },
  count: number,
  mutate: (properties: Record<string, unknown>, index: number) => void
) {
  return {
    ...payload,
    features: Array.from({ length: count }, (_, index) => {
      const source = payload.features[index % payload.features.length] as {
        properties: Record<string, unknown>;
      };
      const properties = { ...source.properties };
      mutate(properties, index);
      return { ...source, id: `maximum-${index}`, properties };
    }),
  };
}

function p95(samples: number[]): number {
  return (
    samples.sort((left, right) => left - right)[Math.ceil(samples.length * 0.95) - 1] ??
    Number.POSITIVE_INFINITY
  );
}

function maximumNhcIndex(): string {
  const summary =
    '<item><title>Summary - Tropical Storm IRIS (1/AL012024)</title><nhc:type>Tropical Storm</nhc:type><nhc:name>IRIS</nhc:name><nhc:atcf>AL012024</nhc:atcf><nhc:datetime>2024-08-25T10:00:00Z</nhc:datetime></item>';
  const products = Array.from(
    { length: 255 },
    (_, index) =>
      `<item><title>Advisory #${String(index % 1000).padStart(3, '0')} Forecast Track [kml] - Tropical Storm IRIS (1/AL012024)</title><link>https://www.nhc.noaa.gov/gis/kml/forecasts/AL012024_${index}.kml</link><guid>maximum-${index}</guid><pubDate>Sun, 25 Aug 2024 10:00:00 GMT</pubDate></item>`
  ).join('');
  return `<rss xmlns:nhc="https://www.nhc.noaa.gov/"><channel>${summary}${products}</channel></rss>`;
}

function maximumCoastalStations(): Parameters<typeof parseCoastalConditions>[0] {
  return Array.from({ length: 100 }, (_, stationIndex) => ({
    metadata: {
      id: String(8_000_000 + stationIndex),
      name: `Maximum station ${stationIndex}`,
      lat: 25 + (stationIndex % 20),
      lng: -120 + (stationIndex % 40),
      timezone: 'UTC',
    },
    station_types: ['water_level' as const],
    datum: 'MLLW' as const,
    units: 'metric' as const,
    time_zone: 'gmt' as const,
    products: {
      water_level: {
        data: Array.from({ length: 100 }, (_, recordIndex) => ({
          t: '2024-08-25 09:54',
          v: String(0.1 + recordIndex / 1000),
          s: '0.01',
          f: '0,0,0,0',
          q: 'p',
        })),
      },
    },
  }));
}

describe('operational-awareness parser performance', () => {
  it('parses every declared maximum record bound below 50 ms p95', () => {
    const clock = new FrozenClock(referenceMs);
    const maximumNws = expandProduct(
      fixture('nws-alerts-synthetic-v1.geojson'),
      500,
      (properties, index) => {
        properties.id = `max-alert-${index}`;
      }
    );
    const maximumMetar = expandProduct(
      fixture('awc-metar-synthetic-v1.geojson'),
      400,
      (properties, index) => {
        properties.icaoId = `K${String(index).padStart(3, '0')}`;
      }
    );
    const maximumTaf = expandProduct(
      fixture('awc-taf-synthetic-v1.geojson'),
      400,
      (properties, index) => {
        properties.icaoId = `T${String(index).padStart(3, '0')}`;
      }
    );
    const maximumSigmet = expandProduct(
      fixture('awc-sigmet-synthetic-v1.geojson'),
      400,
      (properties, index) => {
        properties.id = `max-sigmet-${index}`;
      }
    );
    const maximumNhc = maximumNhcIndex();
    const maximumCoops = maximumCoastalStations();
    const nwsSamples: number[] = [];
    const awcSamples: number[] = [];
    const nhcSamples: number[] = [];
    const coopsSamples: number[] = [];

    for (let warmup = 0; warmup < 5; warmup += 1) {
      parseNwsAlerts(maximumNws, conus, clock, 'seed');
      parseAviationWeather(
        { metar: maximumMetar, taf: maximumTaf, airsigmet: maximumSigmet },
        conus,
        clock,
        'seed'
      );
      parseNhcGisIndex(maximumNhc, 'atlantic');
      parseCoastalConditions(maximumCoops, conus, clock, 'seed');
    }
    for (let iteration = 0; iteration < 50; iteration += 1) {
      let startedAt = performance.now();
      parseNwsAlerts(maximumNws, conus, clock, 'seed');
      nwsSamples.push(performance.now() - startedAt);
      startedAt = performance.now();
      parseAviationWeather(
        { metar: maximumMetar, taf: maximumTaf, airsigmet: maximumSigmet },
        conus,
        clock,
        'seed'
      );
      awcSamples.push(performance.now() - startedAt);
      startedAt = performance.now();
      parseNhcGisIndex(maximumNhc, 'atlantic');
      nhcSamples.push(performance.now() - startedAt);
      startedAt = performance.now();
      parseCoastalConditions(maximumCoops, conus, clock, 'seed');
      coopsSamples.push(performance.now() - startedAt);
    }
    const nwsP95 = p95(nwsSamples);
    const awcP95 = p95(awcSamples);
    const nhcP95 = p95(nhcSamples);
    const coopsP95 = p95(coopsSamples);
    console.log(
      `[Benchmark Operational Parsers] NWS=500 p95:${nwsP95.toFixed(2)}ms | AWC=1200 p95:${awcP95.toFixed(2)}ms | NHC index=256 p95:${nhcP95.toFixed(2)}ms | CO-OPS=100 stations/10000 records p95:${coopsP95.toFixed(2)}ms`
    );
    expect(nwsP95).toBeLessThan(50);
    expect(awcP95).toBeLessThan(50);
    expect(nhcP95).toBeLessThan(50);
    expect(coopsP95).toBeLessThan(50);
  });

  it('projects and filters 2,000 Layer Access entries below 16.6 ms p95', () => {
    const template = createProviderRegistry({ requestedMode: 'seed' }).providers[0];
    if (!template) throw new Error('Provider template unavailable');
    const registry = ProviderRegistrySchema.parse({
      version: 2,
      requested_mode: 'seed',
      providers: Array.from({ length: 2_000 }, (_, index) => ({
        ...template,
        id: `synthetic-${index}`,
        name: `Synthetic Provider ${index.toString().padStart(4, '0')}`,
        feeds: template.feeds.map((feed) => ({ ...feed, id: `synthetic-feed-${index}` })),
        layers: template.layers.map((layer) => ({
          ...layer,
          id: `synthetic-layer-${index}`,
          documentation_path: `docs/data-sources/synthetic-${index}.md`,
        })),
      })),
    }) as ProviderRegistry;
    const runtime: LayerAccessRuntimeSnapshot = {
      version: 1,
      observed_at: '2026-09-06T20:00:00.000Z',
      stasis_active: false,
      budget_remaining_usd: 10,
      authority: {
        kind: 'local_seed',
        credential_status_access: 'unavailable',
        reason: 'Authenticated local credential status is unavailable',
      },
      providers: [],
    };
    for (let index = 0; index < 5; index += 1) createLayerAccessReadModel(registry, runtime);
    const projectionSamples: number[] = [];
    let model = createLayerAccessReadModel(registry, runtime);
    for (let index = 0; index < 50; index += 1) {
      const startedAt = performance.now();
      model = createLayerAccessReadModel(registry, runtime);
      projectionSamples.push(performance.now() - startedAt);
    }
    const filterSamples: number[] = [];
    for (let index = 0; index < 50; index += 1) {
      const startedAt = performance.now();
      filterLayerAccessEntries(model.entries, 'synthetic provider 19', 'available');
      filterSamples.push(performance.now() - startedAt);
    }
    const projectionP95 = p95(projectionSamples);
    const filterP95 = p95(filterSamples);
    console.log(
      `[Benchmark Layer Access] N=2000 projection p95:${projectionP95.toFixed(2)}ms | filter p95:${filterP95.toFixed(2)}ms`
    );
    expect(projectionP95).toBeLessThan(16.6);
    expect(filterP95).toBeLessThan(16.6);
    expect(LayerAccessReadModelSchema.parse(model).entries).toHaveLength(2_000);
  });
});
