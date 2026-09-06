import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OperationalAoi } from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { describe, expect, it } from 'vitest';
import { parseAviationWeather } from '../src/aviationWeather.js';
import { parseNwsAlerts } from '../src/nwsAlerts.js';

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
    const nwsSamples: number[] = [];
    const awcSamples: number[] = [];

    for (let warmup = 0; warmup < 5; warmup += 1) {
      parseNwsAlerts(maximumNws, conus, clock, 'seed');
      parseAviationWeather(
        { metar: maximumMetar, taf: maximumTaf, airsigmet: maximumSigmet },
        conus,
        clock,
        'seed'
      );
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
    }
    const nwsP95 = p95(nwsSamples);
    const awcP95 = p95(awcSamples);
    console.log(
      `[Benchmark Operational Parsers] NWS=500 p95:${nwsP95.toFixed(2)}ms | AWC=1200 p95:${awcP95.toFixed(2)}ms`
    );
    expect(nwsP95).toBeLessThan(50);
    expect(awcP95).toBeLessThan(50);
  });
});
