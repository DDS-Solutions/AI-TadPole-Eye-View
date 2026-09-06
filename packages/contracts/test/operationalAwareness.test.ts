import { describe, expect, it } from 'vitest';
import {
  AviationWeatherResponseSchema,
  NwsAlertCollectionPayloadSchema,
  OperationalAoiSchema,
  OperationalAreaGeometrySchema,
  SolarContextPayloadSchema,
} from '../src/operationalAwareness.js';

describe('operational-awareness contracts', () => {
  it('bounds AOIs and rejects unsupported antimeridian spans', () => {
    expect(
      OperationalAoiSchema.parse({ min_lat: 24, max_lat: 50, min_lon: -125, max_lon: -66 })
    ).toEqual({ min_lat: 24, max_lat: 50, min_lon: -125, max_lon: -66 });
    expect(() =>
      OperationalAoiSchema.parse({ min_lat: 0, max_lat: 31, min_lon: 0, max_lon: 10 })
    ).toThrow(/30 degrees/);
    expect(() =>
      OperationalAoiSchema.parse({ min_lat: -5, max_lat: 5, min_lon: 170, max_lon: -170 })
    ).toThrow(/ANTIMERIDIAN_UNSUPPORTED/);
  });

  it('requires closed, bounded polygon geometry', () => {
    expect(
      OperationalAreaGeometrySchema.safeParse({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      }).success
    ).toBe(true);
    expect(
      OperationalAreaGeometrySchema.safeParse({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        ],
      }).success
    ).toBe(false);
  });

  it('preserves distinct CAP lifecycle times and reference times', () => {
    const alert = {
      id: 'cap-1',
      event: 'Test Warning',
      headline: 'Test warning headline',
      area_description: 'Test area',
      severity: 'Severe',
      certainty: 'Likely',
      urgency: 'Immediate',
      status: 'Test',
      message_type: 'Update',
      sent: '2024-08-25T09:59:00.000Z',
      effective: '2024-08-25T10:00:00.000Z',
      onset: '2024-08-25T10:05:00.000Z',
      expires: '2024-08-25T12:00:00.000Z',
      ends: '2024-08-25T11:30:00.000Z',
      references: [
        {
          sender: 'sender.example',
          identifier: 'cap-0',
          sent: '2024-08-25T09:30:00.000Z',
        },
      ],
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-105, 39],
            [-104, 39],
            [-104, 40],
            [-105, 39],
          ],
        ],
      },
    } as const;
    const parsed = NwsAlertCollectionPayloadSchema.parse({
      generated_at: '2024-08-25T10:00:00.000Z',
      count: 1,
      alerts: [alert],
    });

    expect(parsed.alerts[0]).toMatchObject({
      sent: alert.sent,
      effective: alert.effective,
      onset: alert.onset,
      expires: alert.expires,
      ends: alert.ends,
      references: alert.references,
    });
  });

  it('enforces generated counts and product limits', () => {
    expect(() =>
      NwsAlertCollectionPayloadSchema.parse({
        generated_at: '2024-08-25T10:00:00.000Z',
        count: 2,
        alerts: [],
      })
    ).toThrow(/count/);

    const minimalProvenance = {
      schema_version: 1,
      source: {
        provider_id: 'test',
        feed_id: 'test',
        name: 'test',
        canonical_url: 'https://example.com',
      },
      retrieved_at: '2024-08-25T10:00:00.000Z',
      observation_period: { status: 'unavailable', reason: 'empty test response' },
      vintage: { status: 'unavailable', reason: 'not supplied' },
      mode: 'seed',
      source_mode: 'seed',
      license: { id: 'test', name: 'test' },
      attribution: 'test',
      fixture_id: 'test',
      cache: null,
      freshness: { status: 'unavailable', reason: 'empty', fresh_for_seconds: 60 },
    } as const;
    expect(() =>
      AviationWeatherResponseSchema.parse({
        retrieved_at: '2024-08-25T10:00:00.000Z',
        metars: { count: 401, items: [], provenance: minimalProvenance },
        tafs: { count: 0, items: [], provenance: minimalProvenance },
        sigmets: { count: 0, items: [], provenance: minimalProvenance },
        provenance: minimalProvenance,
      })
    ).toThrow();
  });

  it('requires the four named solar boundaries', () => {
    expect(() =>
      SolarContextPayloadSchema.parse({
        computed_at: '2024-08-25T10:00:00.000Z',
        subsolar_point: { longitude: 0, latitude: 0 },
        boundaries: [],
        north_pole: 'day',
        south_pole: 'night',
      })
    ).toThrow();
  });
});
