import type { SceneState } from '@gev/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FrozenClock } from '../src/clock.js';
import {
  base64UrlToString,
  createSceneDeepLink,
  deserializeScene,
  deserializeSceneSafe,
  getDefaultSceneState,
  parseSceneFromUrl,
  serializeScene,
  stringToBase64Url,
} from '../src/sceneSerializer.js';

describe('Scene Serializer & Deep Links (PLAN.md §2 Law 8)', () => {
  const sampleScene: SceneState = {
    version: 1,
    created_at: '2026-08-25T12:00:00.000Z',
    camera: {
      longitude: 8.5417,
      latitude: 47.4582,
      altitude: 15000,
      heading: 90,
      pitch: -45,
      roll: 0,
    },
    layers: [
      { id: 'flights', enabled: true, opacity: 1 },
      { id: 'osm_raster', enabled: true, opacity: 0.8 },
    ],
    selected_entity: {
      kind: 'aircraft',
      id: '4b1814',
    },
    aois: [
      {
        id: 'aoi-zurich',
        name: 'Zurich Approach',
        coordinates: [
          { longitude: 8.4, latitude: 47.3 },
          { longitude: 8.7, latitude: 47.3 },
          { longitude: 8.7, latitude: 47.6 },
          { longitude: 8.4, latitude: 47.3 },
        ],
      },
    ],
    sim_time: {
      iso: '2026-08-25T12:00:00.000Z',
      rate: 1,
      paused: false,
    },
  };

  it('serializes and deserializes a SceneState losslessly', () => {
    const encoded = serializeScene(sampleScene);
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(0);
    expect(encoded.includes('+')).toBe(false);
    expect(encoded.includes('/')).toBe(false);
    expect(encoded.includes('=')).toBe(false);

    const decoded = deserializeScene(encoded);
    expect(decoded.version).toBe(1);
    expect(decoded.camera.latitude).toBe(47.4582);
    expect(decoded.camera.longitude).toBe(8.5417);
    expect(decoded.layers.length).toBe(2);
    expect(decoded.selected_entity?.id).toBe('4b1814');
    expect(decoded.aois.length).toBe(1);
    expect(decoded.aois[0]?.name).toBe('Zurich Approach');
  });

  it('deserializes raw JSON string payloads', () => {
    const rawJson = JSON.stringify(sampleScene);
    const decoded = deserializeScene(rawJson);
    expect(decoded.camera.altitude).toBe(15000);
  });

  it('creates and parses shareable deep links with #scene= fragment', () => {
    const baseUrl = 'https://godseyeview.app/viewer';
    const deepLink = createSceneDeepLink(baseUrl, sampleScene);

    expect(deepLink.startsWith('https://godseyeview.app/viewer#scene=')).toBe(true);

    const extracted = parseSceneFromUrl(deepLink);
    expect(extracted).not.toBeNull();
    expect(extracted?.camera.pitch).toBe(-45);
    expect(extracted?.selected_entity?.id).toBe('4b1814');
  });

  it('fails safely on malformed or corrupted payloads', () => {
    expect(() => deserializeScene('not-a-valid-base64-or-json')).toThrow();

    const fallback = getDefaultSceneState();
    const safeDecoded = deserializeSceneSafe('corrupted-data', fallback);
    expect(safeDecoded.version).toBe(1);
    expect(safeDecoded.camera.altitude).toBe(20000000);

    const emptyParse = parseSceneFromUrl('https://example.com/viewer#corrupted=123');
    expect(emptyParse).toBeNull();
  });

  it('returns canonical default SceneState baseline using provided clock', () => {
    const clock = new FrozenClock(1724580000000);
    const defaultState = getDefaultSceneState(clock);

    expect(defaultState.version).toBe(1);
    expect(defaultState.camera.altitude).toBe(20000000);
    expect(defaultState.created_at).toBe('2024-08-25T10:00:00.000Z');
    expect(defaultState.layers.some((l) => l.id === 'flights' && l.enabled)).toBe(true);
  });

  it('base64url round-trips arbitrary UTF-8 unicode strings', () => {
    const testString = 'Hello 🌍 世界 — Zurich Airport (ZRH) 🛫';
    const encoded = stringToBase64Url(testString);
    const decoded = base64UrlToString(encoded);
    expect(decoded).toBe(testString);
  });

  it('BENCHMARK: serializeScene and deserializeScene complete in < 5ms across 100 iterations', () => {
    const iterations = 100;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      const encoded = serializeScene(sampleScene);
      const decoded = deserializeScene(encoded);
      expect(decoded.version).toBe(1);
    }

    const duration = performance.now() - start;
    const avgMs = duration / iterations;
    expect(avgMs).toBeLessThan(5.0); // < 5ms SLA
  });

  it('PROPERTY TEST: fast-check verifies lossless round-trip across arbitrary valid scenes', () => {
    const cameraPoseArbitrary = fc.record({
      longitude: fc.double({ min: -180, max: 180, noNaN: true }),
      latitude: fc.double({ min: -90, max: 90, noNaN: true }),
      altitude: fc.double({ min: 0, max: 50000000, noNaN: true }),
      heading: fc.double({ min: 0, max: 360, noNaN: true }),
      pitch: fc.double({ min: -90, max: 90, noNaN: true }),
      roll: fc.double({ min: -180, max: 180, noNaN: true }),
    });

    const layerArbitrary = fc.record({
      id: fc.string({ minLength: 1, maxLength: 32 }).filter((s) => !/[\r\n\t]/.test(s)),
      enabled: fc.boolean(),
      opacity: fc.double({ min: 0, max: 1, noNaN: true }),
    });

    const sceneArbitrary = fc.record({
      version: fc.constant(1 as const),
      created_at: fc.constant('2026-08-25T12:00:00.000Z'),
      camera: cameraPoseArbitrary,
      layers: fc.array(layerArbitrary, { minLength: 1, maxLength: 5 }),
      selected_entity: fc.constant(null),
      aois: fc.constant([]),
      sim_time: fc.record({
        iso: fc.constant('2026-08-25T12:00:00.000Z'),
        rate: fc.double({ min: 0.1, max: 10, noNaN: true }),
        paused: fc.boolean(),
      }),
    });

    fc.assert(
      fc.property(sceneArbitrary, (scene) => {
        const encoded = serializeScene(scene);
        const decoded = deserializeScene(encoded);

        expect(decoded.version).toBe(1);
        expect(decoded.camera.latitude).toBeCloseTo(scene.camera.latitude, 5);
        expect(decoded.camera.longitude).toBeCloseTo(scene.camera.longitude, 5);
        expect(decoded.camera.altitude).toBeCloseTo(scene.camera.altitude, 1);
        expect(decoded.layers.length).toBe(scene.layers.length);
        expect(decoded.sim_time.paused).toBe(scene.sim_time.paused);
      }),
      { numRuns: 50 }
    );
  });
});
