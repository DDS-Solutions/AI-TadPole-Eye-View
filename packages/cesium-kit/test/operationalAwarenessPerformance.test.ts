import type {
  AviationWeatherResponse,
  CoastalConditionsResponse,
  NwsAlertCollection,
  TropicalCycloneResponse,
} from '@gev/contracts';
import type { CustomDataSource, Viewer } from 'cesium';
import { describe, expect, it } from 'vitest';
import { AviationWeatherLayerController } from '../src/aviationWeatherLayer.js';
import { CoastalConditionsLayerController } from '../src/coastalConditionsLayer.js';
import { NwsAlertLayerController } from '../src/nwsAlertLayer.js';
import { TropicalCycloneLayerController } from '../src/tropicalCycloneLayer.js';

const INGESTION_P95_BUDGET_MS = 16.6;

function createMockViewer(): Viewer {
  return {
    dataSources: {
      add: (dataSource: CustomDataSource) => Promise.resolve(dataSource),
      remove: () => true,
    },
  } as unknown as Viewer;
}

describe('operational-awareness ingestion performance', () => {
  it(`updates the maximum combined operational batch under ${INGESTION_P95_BUDGET_MS} ms p95`, () => {
    const alerts = new NwsAlertLayerController({ viewer: createMockViewer() });
    const aviation = new AviationWeatherLayerController({ viewer: createMockViewer() });
    const tropicalCyclones = new TropicalCycloneLayerController({ viewer: createMockViewer() });
    const coastalConditions = new CoastalConditionsLayerController({ viewer: createMockViewer() });
    const alertCollection = {
      alerts: Array.from({ length: 500 }, (_, index) => ({
        id: `alert-${index}`,
        headline: `Alert ${index}`,
        severity: index % 2 === 0 ? 'Severe' : 'Moderate',
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
      })),
    } as NwsAlertCollection;
    const points = Array.from({ length: 400 }, (_, index) => ({
      id: `point-${index}`,
      station_id: `K${String(index).padStart(3, '0')}`,
      position: { longitude: -120 + (index % 40), latitude: 25 + (index % 20) },
    }));
    const weather = {
      metars: { items: points },
      tafs: { items: points },
      sigmets: {
        items: Array.from({ length: 400 }, (_, index) => ({
          id: `sigmet-${index}`,
          hazard: 'CONVECTIVE',
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
        })),
      },
    } as AviationWeatherResponse;
    const tropical = {
      advisories: Array.from({ length: 256 }, (_, index) => ({
        id: `cyclone-${index}`,
        storm_name: `Storm ${index}`,
        storm_type: 'Tropical Storm',
        product: 'track',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-80 + (index % 10), 20],
            [-79 + (index % 10), 21],
          ],
        },
      })),
    } as TropicalCycloneResponse;
    const coastal = {
      stations: Array.from({ length: 100 }, (_, index) => ({
        station_id: `station${index}`,
        name: `Station ${index}`,
        position: { longitude: -125 + index * 0.5, latitude: 25 + (index % 20) },
        datum: index % 2 === 0 ? 'MLLW' : null,
        units: 'metric',
        time_zone: 'gmt',
        station_time_zone_name: 'UTC',
        metadata_retrieved_at: '2024-08-25T10:00:00.000Z',
        water_level_observations: [],
        tide_predictions: [],
        current_observations: [],
        current_predictions: [],
      })),
    } as CoastalConditionsResponse;

    for (let warmup = 0; warmup < 5; warmup += 1) {
      alerts.enqueueCollection(alertCollection);
      aviation.enqueueWeather(weather);
      tropicalCyclones.enqueueAdvisories(tropical);
      coastalConditions.enqueueConditions(coastal);
    }
    const latencies: number[] = [];
    for (let iteration = 0; iteration < 50; iteration += 1) {
      const startedAt = performance.now();
      alerts.enqueueCollection(alertCollection);
      aviation.enqueueWeather(weather);
      tropicalCyclones.enqueueAdvisories(tropical);
      coastalConditions.enqueueConditions(coastal);
      latencies.push(performance.now() - startedAt);
    }
    latencies.sort((left, right) => left - right);
    const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;

    console.log(
      `[Benchmark Operational Awareness] Entities=2056 | Budget=${INGESTION_P95_BUDGET_MS.toFixed(1)}ms p95 | p95: ${p95.toFixed(2)}ms`
    );
    expect(p95).toBeLessThan(INGESTION_P95_BUDGET_MS);
    expect(
      alerts.getEntityCount() +
        aviation.getEntityCount() +
        tropicalCyclones.getEntityCount() +
        coastalConditions.getEntityCount()
    ).toBe(2_056);
    alerts.destroy();
    aviation.destroy();
    tropicalCyclones.destroy();
    coastalConditions.destroy();
  });
});
