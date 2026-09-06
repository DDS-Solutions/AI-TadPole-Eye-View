import type {
  AviationWeatherResponse,
  DataProvenance,
  NwsAlertCollection,
  SolarContextResponse,
} from '@gev/contracts';
import { calculateSolarContextAt } from '@gev/core';
import type { CustomDataSource, Viewer } from 'cesium';
import { describe, expect, it } from 'vitest';
import { AviationWeatherLayerController } from '../src/aviationWeatherLayer.js';
import { NwsAlertLayerController } from '../src/nwsAlertLayer.js';
import { SolarContextLayerController } from '../src/solarContextLayer.js';

const referenceTime = '2024-08-25T10:00:00.000Z';

function createMockViewer(): Viewer {
  const dataSources = new Set<CustomDataSource>();
  return {
    dataSources: {
      add: (dataSource: CustomDataSource) => {
        dataSources.add(dataSource);
        return Promise.resolve(dataSource);
      },
      remove: (dataSource: CustomDataSource) => dataSources.delete(dataSource),
    },
  } as unknown as Viewer;
}

function provenance(feedId: string): DataProvenance {
  return {
    schema_version: 1,
    source: {
      provider_id: 'gev-test',
      feed_id: feedId,
      name: 'Synthetic controller test',
      canonical_url: 'https://example.com/test',
    },
    retrieved_at: referenceTime,
    observation_period: { status: 'available', start: referenceTime, end: referenceTime },
    vintage: { status: 'unavailable', reason: 'not applicable' },
    mode: 'seed',
    source_mode: 'seed',
    license: { id: 'MIT', name: 'MIT' },
    attribution: 'Synthetic GEV test',
    fixture_id: 'controller-test',
    cache: null,
    freshness: { status: 'fresh', age_seconds: 0, fresh_for_seconds: 60 },
  };
}

function alertCollection(): NwsAlertCollection {
  return {
    generated_at: referenceTime,
    count: 1,
    alerts: [
      {
        id: 'alert-1',
        event: 'Test Warning',
        headline: 'Synthetic warning',
        area_description: 'Synthetic area',
        severity: 'Severe',
        certainty: 'Likely',
        urgency: 'Immediate',
        status: 'Test',
        message_type: 'Alert',
        sent: '2024-08-25T09:59:45.000Z',
        effective: '2024-08-25T09:59:45.000Z',
        onset: referenceTime,
        expires: '2024-08-25T12:00:00.000Z',
        ends: '2024-08-25T11:30:00.000Z',
        references: [],
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
      },
    ],
    provenance: provenance('nws-alerts'),
  };
}

function aviationResponse(): AviationWeatherResponse {
  const metarProvenance = provenance('aviation-metar');
  const tafProvenance = provenance('aviation-taf');
  const sigmetProvenance = provenance('aviation-sigmet');
  return {
    retrieved_at: referenceTime,
    metars: {
      count: 1,
      items: [
        {
          id: 'metar-kden',
          station_id: 'KDEN',
          position: { longitude: -104.67, latitude: 39.85 },
          observation_time: referenceTime,
          raw_text: 'KDEN TEST METAR',
          flight_category: 'VFR',
          temperature_c: 18,
          wind_speed_kt: 8,
        },
      ],
      provenance: metarProvenance,
    },
    tafs: {
      count: 1,
      items: [
        {
          id: 'taf-kden',
          station_id: 'KDEN',
          position: { longitude: -104.67, latitude: 39.85 },
          issue_time: referenceTime,
          valid_from: referenceTime,
          valid_to: '2024-08-26T12:00:00.000Z',
          raw_text: 'KDEN TEST TAF',
        },
      ],
      provenance: tafProvenance,
    },
    sigmets: {
      count: 1,
      items: [
        {
          id: 'sigmet-1',
          hazard: 'CONVECTIVE',
          issue_time: referenceTime,
          valid_from: referenceTime,
          valid_to: '2024-08-25T13:00:00.000Z',
          raw_text: 'SYNTHETIC SIGMET',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-101, 32],
                [-94, 32],
                [-94, 37],
                [-101, 32],
              ],
            ],
          },
        },
      ],
      provenance: sigmetProvenance,
    },
    provenance: metarProvenance,
  };
}

function solarResponse(atMs: number): SolarContextResponse {
  return { ...calculateSolarContextAt(atMs, 72), provenance: provenance('solar-context') };
}

describe('operational-awareness Cesium controllers', () => {
  it('renders, updates, and clears NWS alert snapshots', () => {
    const layer = new NwsAlertLayerController({ viewer: createMockViewer() });
    layer.enqueueCollection(alertCollection());
    expect(layer.getAlertIds()).toEqual(['alert-1']);
    expect(layer.getEntityCount()).toBe(1);
    layer.clear();
    expect(layer.getEntityCount()).toBe(0);
    layer.destroy();
  });

  it('renders METAR, TAF, and SIGMET products and clears an empty state', () => {
    const layer = new AviationWeatherLayerController({ viewer: createMockViewer() });
    layer.enqueueWeather(aviationResponse());
    expect(layer.getWeatherIds()).toEqual(['metar-metar-kden', 'taf-taf-kden', 'sigmet-sigmet-1']);
    expect(layer.getEntityCount()).toBe(3);
    layer.clear();
    expect(layer.getEntityCount()).toBe(0);
    layer.destroy();
  });

  it('limits SimClock-driven solar rendering to one accepted update per second', () => {
    const layer = new SolarContextLayerController({ viewer: createMockViewer() });
    const initialMs = Date.parse(referenceTime);
    layer.enqueueContext(solarResponse(initialMs));
    layer.enqueueContext(solarResponse(initialMs + 999));
    expect(layer.getAppliedUpdateCount()).toBe(1);
    expect(layer.getEntityCount()).toBe(5);
    layer.enqueueContext(solarResponse(initialMs + 1_000));
    expect(layer.getAppliedUpdateCount()).toBe(2);
    layer.setVisible(false);
    expect(layer.dataSource.show).toBe(false);
    layer.destroy();
  });
});
