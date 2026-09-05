import type { SatellitePropagationBatch } from '@gev/contracts';
import type { CustomDataSource, Viewer } from 'cesium';
import { describe, expect, it } from 'vitest';
import { SatelliteLayerController } from '../src/satelliteLayer.js';

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

function batch(): SatellitePropagationBatch {
  return {
    input_count: 1,
    omitted_count: 0,
    states: [
      {
        catalog_id: 'synthetic-001',
        object_name: 'GEV SYNTHETIC LEO 1',
        object_id: null,
        source_group: 'synthetic',
        element_epoch: '2026-09-04T12:00:00.000Z',
        propagated_at: '2026-09-04T12:30:00.000Z',
        propagation_method: 'sgp4',
        is_estimate: true,
        longitude_deg: -75,
        latitude_deg: 40,
        altitude_m: 420_000,
        speed_mps: 7_650,
      },
    ],
  } as SatellitePropagationBatch;
}

describe('SatelliteLayerController', () => {
  it('drains propagated estimates through the base rAF queue with safety metadata', () => {
    const controller = new SatelliteLayerController({ viewer: createMockViewer() });
    controller.enqueueBatch(batch());

    expect(controller.getEntityCount()).toBe(1);
    expect(controller.getSatelliteIds()).toEqual(['synthetic-001']);
    const entity = controller.dataSource.entities.getById('satellite-synthetic-001');
    expect(entity).toBeDefined();
    expect(entity?.properties?.getValue(new Date())).toMatchObject({
      entityKind: 'satellite',
      isEstimate: true,
      propagationMethod: 'sgp4',
    });

    const updated = batch();
    const state = updated.states[0];
    if (!state) throw new Error('satellite test fixture must contain one state');
    state.propagated_at = '2026-09-04T12:35:00.000Z';
    state.longitude_deg = -74;
    state.latitude_deg = 41;
    state.altitude_m = 421_000;
    state.speed_mps = 7_640;
    controller.enqueueBatch(updated);
    expect(entity?.properties?.getValue(new Date())).toMatchObject({
      propagatedAt: '2026-09-04T12:35:00.000Z',
      longitude: -74,
      latitude: 41,
      altitudeM: 421_000,
      speedMps: 7_640,
    });

    controller.setVisible(false);
    expect(controller.dataSource.show).toBe(false);
    controller.destroy();
    expect(controller.getEntityCount()).toBe(0);
  });
});
