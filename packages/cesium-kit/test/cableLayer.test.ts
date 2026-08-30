import type { CableCatalogResponse } from '@gev/contracts';
import type { CustomDataSource, Viewer } from 'cesium';
import { describe, expect, it } from 'vitest';
import { CableLayerController } from '../src/cableLayer.js';

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

function catalog(): CableCatalogResponse {
  return {
    landing_points: [
      { id: 'landing-a', name: 'Landing A', country: 'Fixture', longitude: -70, latitude: 40 },
      { id: 'landing-b', name: 'Landing B', country: 'Fixture', longitude: 5, latitude: 50 },
    ],
    routes: [
      {
        id: 'route-a',
        name: 'Route A',
        status: 'active',
        owners: ['Fixture operator'],
        rfs_year: 2026,
        length_km: 5_000,
        landing_point_ids: ['landing-a', 'landing-b'],
        segments: [
          [
            [-70, 40],
            [5, 50],
          ],
        ],
      },
    ],
  } as CableCatalogResponse;
}

describe('CableLayerController', () => {
  it('drains validated routes and landing points through the base rAF queue', () => {
    const controller = new CableLayerController({ viewer: createMockViewer() });
    controller.enqueueCatalog(catalog());

    expect(controller.getRouteCount()).toBe(1);
    expect(controller.getLandingPointCount()).toBe(2);
    expect(controller.getEntityCount()).toBe(3);
    expect(controller.dataSource.entities.getById('cable-route-route-a-0')).toBeDefined();
    expect(controller.dataSource.entities.getById('cable-landing-landing-a')).toBeDefined();

    controller.setVisible(false);
    expect(controller.dataSource.show).toBe(false);
    controller.destroy();
    expect(controller.getEntityCount()).toBe(0);
  });
});
