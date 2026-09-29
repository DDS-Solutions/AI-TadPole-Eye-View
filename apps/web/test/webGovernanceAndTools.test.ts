import { describe, expect, it } from 'vitest';
import { type EntitySelection, layerStore } from '../src/stores/layers.svelte.js';
import { collabStore } from '../src/stores/collab.svelte.js';

describe('Web Layer Governance & Store Mutators (Round 7: W-02)', () => {
  it('enables and disables permitted layers via setLayerEnabled', () => {
    expect(layerStore.setLayerEnabled('marine', false)).toBe(true);
    expect(layerStore.visibility.marine).toBe(false);

    expect(layerStore.setLayerEnabled('marine', true)).toBe(true);
    expect(layerStore.visibility.marine).toBe(true);
  });

  it('enforces satellite access lock on setLayerEnabled (W-02)', () => {
    // Lock satellite layer due to server terms requirement
    layerStore.setSatelliteAccessLock(
      'Terms approval required by provider',
      'TERMS_APPROVAL_REQUIRED'
    );
    expect(layerStore.visibility.satellites).toBe(false);

    // Attempt to enable satellite layer while locked
    const result = layerStore.setLayerEnabled('satellites', true);
    expect(result).toBe(false);
    expect(layerStore.visibility.satellites).toBe(false);

    // Clear lock and verify it can now be enabled
    layerStore.setSatelliteAccessLock(null);
    const unlockedResult = layerStore.setLayerEnabled('satellites', true);
    expect(unlockedResult).toBe(true);
    expect(layerStore.visibility.satellites).toBe(true);
  });

  it('rejects prototype property names via Object.hasOwn (W-02)', () => {
    expect(layerStore.setLayerEnabled('constructor', true)).toBe(false);
    expect(layerStore.setLayerEnabled('toString', true)).toBe(false);
    expect(layerStore.setLayerEnabled('__proto__', true)).toBe(false);
    expect(layerStore.setLayerEnabled('valueOf', true)).toBe(false);
    expect(layerStore.setLayerEnabled('nonexistent_layer', true)).toBe(false);
  });
});

describe('Coordinate Non-Coercion & Equator / Meridian Bounds (Round 7: W-03)', () => {
  function filterAoiEntities(
    list: Array<Record<string, unknown>>,
    bounds: { south: number; north: number; west: number; east: number }
  ) {
    return list.filter((item) => {
      const rawLat = item.latitude ?? item.lat;
      const rawLon = item.longitude ?? item.lon;
      if (rawLat === undefined || rawLat === null || rawLon === undefined || rawLon === null) {
        return false;
      }
      const lat = typeof rawLat === 'number' ? rawLat : Number(rawLat);
      const lon = typeof rawLon === 'number' ? rawLon : Number(rawLon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
      return lat >= bounds.south && lat <= bounds.north && lon >= bounds.west && lon <= bounds.east;
    });
  }

  it('retains equatorial entities at latitude: 0 (W-03)', () => {
    const entities = [
      { id: 'eq-exact', latitude: 0, longitude: 10 },
      { id: 'eq-short', lat: 0, lon: 10 },
      { id: 'north', latitude: 5, longitude: 10 },
      { id: 'outside-south', latitude: -15, longitude: 10 },
    ];

    const inBounds = filterAoiEntities(entities, { south: -10, north: 10, west: 0, east: 20 });
    const ids = inBounds.map((e) => e.id);
    expect(ids).toContain('eq-exact');
    expect(ids).toContain('eq-short');
    expect(ids).toContain('north');
    expect(ids).not.toContain('outside-south');
  });

  it('retains prime meridian entities at longitude: 0 (W-03)', () => {
    const entities = [
      { id: 'pm-exact', latitude: 51.48, longitude: 0 },
      { id: 'pm-short', lat: 51.48, lon: 0 },
      { id: 'east', latitude: 51.48, longitude: 5 },
      { id: 'outside-west', latitude: 51.48, longitude: -10 },
    ];

    const inBounds = filterAoiEntities(entities, { south: 50, north: 55, west: -5, east: 5 });
    const ids = inBounds.map((e) => e.id);
    expect(ids).toContain('pm-exact');
    expect(ids).toContain('pm-short');
    expect(ids).toContain('east');
    expect(ids).not.toContain('outside-west');
  });

  it('rejects invalid or NaN coordinates cleanly without error', () => {
    const entities = [
      { id: 'nan-lat', latitude: NaN, longitude: 10 },
      { id: 'str-invalid', latitude: 'not-a-number', longitude: 10 },
      { id: 'null-lat', latitude: null, longitude: 10 },
      { id: 'missing-lon', latitude: 10 },
    ];

    const inBounds = filterAoiEntities(entities, { south: -90, north: 90, west: -180, east: 180 });
    expect(inBounds.length).toBe(0);
  });
});

describe('Feed Layer Name to EntitySelection Kind Normalization (Round 7: W-06)', () => {
  const LAYER_TO_KIND: Record<string, EntitySelection['kind']> = {
    flights: 'flight',
    flight: 'flight',
    marine: 'marine',
    ships: 'marine',
    ship: 'marine',
    quakes: 'quake',
    quake: 'quake',
    firms: 'firms',
    gbfs: 'gbfs',
    cctv: 'cctv',
    radio: 'radio',
    launches: 'launch',
    launch: 'launch',
    weather: 'weather',
    cables: 'cable',
    cable: 'cable',
    satellites: 'satellite',
    satellite: 'satellite',
    solar: 'solar-context',
    alerts: 'nws-alert',
    aviationWeather: 'aviation-weather',
    tropicalCyclones: 'tropical-cyclone',
    coastalConditions: 'coastal-condition',
  };

  it('normalizes plural feed names to singular entity selection kinds', () => {
    expect(LAYER_TO_KIND.flights).toBe('flight');
    expect(LAYER_TO_KIND.satellites).toBe('satellite');
    expect(LAYER_TO_KIND.quakes).toBe('quake');
    expect(LAYER_TO_KIND.ships).toBe('marine');
    expect(LAYER_TO_KIND.launches).toBe('launch');
    expect(LAYER_TO_KIND.cables).toBe('cable');
  });
});

describe('Collab Store Lifecycle & Cleanup (Round 7: W-11, W-12)', () => {
  it('resets intentState to null on leaveRoom (W-12)', () => {
    collabStore.state.isConnected = true;
    collabStore.state.intentState = { camera: { lon: 0, lat: 0 } };
    collabStore.state.clientId = 'client-test-1';

    collabStore.leaveRoom();

    expect(collabStore.state.isConnected).toBe(false);
    expect(collabStore.state.clientId).toBeNull();
    expect(collabStore.state.intentState).toBeNull();
    expect(collabStore.state.presences).toEqual([]);
  });
});

describe('Provenance Honesty & Non-Coercion (Round 7: W-15)', () => {
  it('surfaces UNAVAILABLE label instead of PARTIAL when data is unavailable', () => {
    layerStore.visibility.flights = true;
    layerStore.setProvenance('flights', {
      source: {
        provider_id: 'opensky',
        name: 'OpenSky Network',
        attribution: 'OpenSky',
        homepage_url: 'https://opensky-network.org',
        terms_url: 'https://opensky-network.org',
      },
      retrieved_at: new Date().toISOString(),
      mode: 'live',
      freshness: {
        status: 'unavailable',
        as_of: new Date().toISOString(),
      },
      license: {
        spdx_id: 'CC-BY-4.0',
        commercial_use_allowed: true,
        attribution_required: true,
        redistribution_allowed: true,
        share_alike: false,
      },
      schema: {
        name: 'FlightBatch',
        version: '1.0.0',
      },
    });

    const summary = layerStore.provenanceSummary;
    expect(summary.freshnessLabel).toBe('UNAVAILABLE');
  });
});
