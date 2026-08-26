import { describe, expect, it } from 'vitest';
import {
  ApprovalRequest,
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

describe('Contracts Unit Tests', () => {
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

  it('validates flight state telemetry and bounding boxes', () => {
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

    const bbox = BoundingBox.parse({
      min_lat: 40.0,
      max_lat: 50.0,
      min_lon: -10.0,
      max_lon: 15.0,
    });
    expect(bbox.min_lat).toBe(40.0);
  });

  it('validates serialized scene schema', () => {
    const scene = SceneState.parse({
      version: '1.0.0',
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
    expect(scene.version).toBe('1.0.0');
  });
});
