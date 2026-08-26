import { describe, expect, it } from 'vitest';
import {
  ApprovalRequest,
  AreaOfInterest,
  AuditIntent,
  AuditOutcome,
  BoundingBox,
  BudgetState,
  CostEstimate,
  FlightBatch,
  FlightState,
  GevEvents,
  SceneState,
  Verdict,
} from '../src/index.js';

describe('Contracts Unit & Invariant Tests (Review Round 2)', () => {
  describe('Audit Contracts', () => {
    it('validates a valid AuditIntent and AuditOutcome pair', () => {
      const validIntent = AuditIntent.parse({
        kind: GevEvents.AuditIntent,
        id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        ts: '2026-08-25T12:00:00.000Z',
        actor: 'ai',
        action: 'ops.set_flag',
        target: 'provider.opensky.enabled',
        params: { value: true },
        task_ref: 'brief-001',
      });
      expect(validIntent.action).toBe('ops.set_flag');

      const validOutcome = AuditOutcome.parse({
        kind: GevEvents.AuditOutcome,
        intent_id: validIntent.id,
        ts: '2026-08-25T12:00:01.000Z',
        status: 'ok',
        result: { updated: true },
        duration_ms: 120,
      });
      expect(validOutcome.status).toBe('ok');
    });

    it('rejects blocked outcomes that omit error reason', () => {
      expect(() => {
        AuditOutcome.parse({
          kind: GevEvents.AuditOutcome,
          intent_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          ts: '2026-08-25T12:00:01.000Z',
          status: 'blocked',
        });
      }).toThrow(/blocked outcomes must state why/);
    });
  });

  describe('Budget & Cost Estimates (.finite() checks)', () => {
    it('validates cost estimates and budgets', () => {
      const validEstimate = CostEstimate.parse({
        currency: 'usd',
        min: 0.05,
        max: 0.15,
      });
      expect(validEstimate.max).toBe(0.15);

      expect(() => {
        CostEstimate.parse({
          currency: 'usd',
          min: 0.5,
          max: 0.1,
        });
      }).toThrow(/min exceeds max/);
    });

    it('rejects Infinity in CostEstimate and BudgetState money fields (P2)', () => {
      expect(() => {
        CostEstimate.parse({
          currency: 'usd',
          min: 0,
          max: Number.POSITIVE_INFINITY,
        });
      }).toThrow();

      expect(() => {
        BudgetState.parse({
          stasis_active: false,
          period_start: '2026-08-25T12:00:00.000Z',
          spent_usd: Number.POSITIVE_INFINITY,
          cap_usd: 100,
          warn_threshold_pct: 80,
          last_trip: null,
        });
      }).toThrow();
    });
  });

  describe('Flight Telemetry & BoundingBox Constraints (P2, P3)', () => {
    it('validates flight state telemetry and rejects Infinity in coordinates / physical quantities', () => {
      const flight = FlightState.parse({
        icao24: '4b1814',
        callsign: 'SWR138',
        origin_country: 'Switzerland',
        last_contact: 1724580000,
        longitude: 8.5417,
        latitude: 47.4582,
        baro_altitude: 10000,
        on_ground: false,
        velocity: 230.5,
        true_track: 185.0,
        vertical_rate: -3.5,
      });
      expect(flight.icao24).toBe('4b1814');

      // Rejects Infinity in latitude / longitude / velocity
      expect(() => {
        FlightState.parse({
          icao24: '4b1814',
          last_contact: 1724580000,
          latitude: Number.POSITIVE_INFINITY,
          longitude: 8.5,
        });
      }).toThrow();

      expect(() => {
        FlightState.parse({
          icao24: '4b1814',
          last_contact: 1724580000,
          latitude: 47.0,
          longitude: 8.5,
          velocity: Number.POSITIVE_INFINITY,
        });
      }).toThrow();
    });

    it('validates cross-field ordered BoundingBox and rejects inverted boxes (P3)', () => {
      const validBox = BoundingBox.parse({
        min_lat: 40.0,
        max_lat: 50.0,
        min_lon: -10.0,
        max_lon: 15.0,
      });
      expect(validBox.min_lat).toBe(40.0);

      // Inverted latitude (min_lat > max_lat) rejected
      expect(() => {
        BoundingBox.parse({
          min_lat: 50.0,
          max_lat: 40.0,
          min_lon: -10.0,
          max_lon: 15.0,
        });
      }).toThrow(/min_lat must not exceed max_lat/);

      // Antimeridian wrap (min_lon > max_lon) rejected with named error
      expect(() => {
        BoundingBox.parse({
          min_lat: 40.0,
          max_lat: 50.0,
          min_lon: 170.0,
          max_lon: -170.0,
        });
      }).toThrow(/ANTIMERIDIAN_UNSUPPORTED/);
    });
  });

  describe('SceneState, Versioning & Ring Closure (P2, P4)', () => {
    it('validates SceneState with version: 1 literal', () => {
      const scene = SceneState.parse({
        version: 1,
        created_at: '2026-08-25T12:00:00.000Z',
        camera: {
          longitude: 0,
          latitude: 0,
          altitude: 10000000,
          heading: 0,
          pitch: -90,
          roll: 0,
        },
        layers: [{ id: 'flights', enabled: true, opacity: 1 }],
        selected_entity: null,
        aois: [],
        sim_time: {
          iso: '2026-08-25T12:00:00.000Z',
          rate: 1,
          paused: false,
        },
      });
      expect(scene.version).toBe(1);

      // Rejects incorrect version
      expect(() => {
        SceneState.parse({
          ...scene,
          version: 2,
        });
      }).toThrow();
    });

    it('deterministically normalizes AOI polygon ring closure on parse (P4)', () => {
      // Unclosed triangle (3 distinct points)
      const parsedAoi = AreaOfInterest.parse({
        id: 'aoi-1',
        name: 'Baltic Sea Sector',
        coordinates: [
          { longitude: 18.0, latitude: 58.0 },
          { longitude: 20.0, latitude: 58.0 },
          { longitude: 19.0, latitude: 59.0 },
        ],
      });

      // Output should have 4 coordinates where first === last
      expect(parsedAoi.coordinates.length).toBe(4);
      expect(parsedAoi.coordinates[0]).toEqual(parsedAoi.coordinates[3]);
      expect(parsedAoi.coordinates[0]?.longitude).toBe(18.0);
      expect(parsedAoi.coordinates[3]?.longitude).toBe(18.0);
    });

    it('rejects Infinity in camera pose coordinates and angles', () => {
      expect(() => {
        SceneState.parse({
          version: 1,
          created_at: '2026-08-25T12:00:00.000Z',
          camera: {
            longitude: 0,
            latitude: 0,
            altitude: Number.POSITIVE_INFINITY,
            heading: 0,
            pitch: -90,
            roll: 0,
          },
          layers: [],
          selected_entity: null,
          aois: [],
          sim_time: { iso: '2026-08-25T12:00:00.000Z', rate: 1, paused: false },
        });
      }).toThrow();
    });
  });
});
