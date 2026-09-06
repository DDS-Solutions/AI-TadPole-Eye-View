import type {
  AviationWeatherResponse,
  CoastalConditionsResponse,
  DataProvenance,
  NwsAlertCollection,
  SolarContextResponse,
  TropicalCycloneResponse,
} from '@gev/contracts';
import { calculateSolarContextAt } from '@gev/core';
import type { CustomDataSource, Viewer } from 'cesium';
import { describe, expect, it } from 'vitest';
import { AviationWeatherLayerController } from '../src/aviationWeatherLayer.js';
import { CoastalConditionsLayerController } from '../src/coastalConditionsLayer.js';
import { NwsAlertLayerController } from '../src/nwsAlertLayer.js';
import { SolarContextLayerController } from '../src/solarContextLayer.js';
import { TropicalCycloneLayerController } from '../src/tropicalCycloneLayer.js';

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

function tropicalCycloneResponse(): TropicalCycloneResponse {
  return {
    retrieved_at: referenceTime,
    count: 2,
    advisories: [
      {
        id: 'iris-track',
        storm_id: 'AL012024',
        storm_name: 'IRIS',
        storm_type: 'Tropical Storm',
        basin: 'atlantic',
        advisory_number: '001',
        product: 'track',
        issued_at: referenceTime,
        observation_time: referenceTime,
        valid_from: referenceTime,
        valid_to: '2024-08-25T16:00:00.000Z',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-77, 24],
            [-78.2, 25.5],
          ],
        },
        forecast_points: [{ position: { longitude: -77, latitude: 24 }, valid_at: referenceTime }],
        warning_type: null,
      },
      {
        id: 'iris-cone',
        storm_id: 'AL012024',
        storm_name: 'IRIS',
        storm_type: 'Tropical Storm',
        basin: 'atlantic',
        advisory_number: '001',
        product: 'cone',
        issued_at: referenceTime,
        observation_time: referenceTime,
        valid_from: referenceTime,
        valid_to: '2024-08-25T16:00:00.000Z',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-77.5, 23.5],
              [-80.8, 27],
              [-78, 26],
              [-77.5, 23.5],
            ],
          ],
        },
        forecast_points: [],
        warning_type: null,
      },
    ],
    usage_notice: 'Synthetic controller test only.',
    provenance: provenance('tropical-cyclone-advisories'),
  };
}

function coastalConditionsResponse(): CoastalConditionsResponse {
  const waterProvenance = provenance('coastal-water-levels');
  const currentProvenance = provenance('coastal-currents');
  return {
    retrieved_at: referenceTime,
    count: 1,
    record_count: 2,
    stations: [
      {
        station_id: '8724580',
        name: 'Key West, FL',
        position: { longitude: -81.8081, latitude: 24.5508 },
        station_types: ['water_level', 'tide_prediction'],
        datum: 'MLLW',
        units: 'metric',
        time_zone: 'gmt',
        station_time_zone_name: 'America/New_York',
        metadata_retrieved_at: referenceTime,
        water_level_observations: [
          {
            observed_at: referenceTime,
            value: { status: 'unavailable', reason: 'Synthetic missing value' },
            sigma: 0.012,
            quality: 'preliminary',
            flags: ['0'],
          },
        ],
        tide_predictions: [
          {
            valid_at: '2024-08-25T16:00:00.000Z',
            value: { status: 'available', value: 0.812 },
            tide_type: 'H',
          },
        ],
        current_observations: [],
        current_predictions: [],
      },
    ],
    usage_notice: 'Synthetic controller test only.',
    water_level_provenance: waterProvenance,
    current_provenance: currentProvenance,
    provenance: waterProvenance,
  };
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

  it('renders ordinary entities for bounded cyclone advisory products', () => {
    const layer = new TropicalCycloneLayerController({ viewer: createMockViewer() });
    layer.enqueueAdvisories(tropicalCycloneResponse());
    expect(layer.getAdvisoryIds()).toEqual(['iris-track', 'iris-cone']);
    expect(layer.getEntityCount()).toBe(2);
    layer.clear();
    expect(layer.getEntityCount()).toBe(0);
    layer.destroy();
  });

  it('keeps unavailable coastal values null on the Cesium entity boundary', () => {
    const layer = new CoastalConditionsLayerController({ viewer: createMockViewer() });
    layer.enqueueConditions(coastalConditionsResponse());
    expect(layer.getCoastalStationIds()).toEqual(['8724580']);
    expect(layer.getEntityCount()).toBe(1);
    const entity = layer.dataSource.entities.getById('coastal-condition-8724580');
    expect(entity?.properties?.latestWaterLevel?.getValue()).toBeNull();
    expect(entity?.properties?.nextTideLevel?.getValue()).toBe(0.812);
    layer.clear();
    expect(layer.getEntityCount()).toBe(0);
    layer.destroy();
  });
});
