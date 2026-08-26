import type { CustomDataSource, Viewer } from 'cesium';
import { describe, expect, it } from 'vitest';
import { attachDebugBus } from '../src/debugBus.js';
import { FirmsLayerController } from '../src/firmsLayer.js';
import { FlightLayerController } from '../src/flightLayer.js';
import { GbfsLayerController } from '../src/gbfsLayer.js';
import type { GlobeController } from '../src/globe.js';
import { MarineLayerController } from '../src/marineLayer.js';
import { QuakeLayerController } from '../src/quakeLayer.js';

function createMockViewer(): Viewer {
  const dataSources = new Set<CustomDataSource>();
  return {
    dataSources: {
      add: (ds: CustomDataSource) => {
        dataSources.add(ds);
        return Promise.resolve(ds);
      },
      remove: (ds: CustomDataSource) => {
        dataSources.delete(ds);
        return true;
      },
    },
    camera: {
      heading: 0,
      pitch: -1.57,
      roll: 0,
      positionCartographic: {
        longitude: 0,
        latitude: 0,
        height: 1000000,
      },
    },
    isDestroyed: () => false,
    destroy: () => {},
  } as unknown as Viewer;
}

describe('Cesium Telemetry Layer Controllers (PLAN.md §10 Phase 2 Layers 2-5)', () => {
  it('FlightLayerController: mounts datasource and enqueues states', () => {
    const viewer = createMockViewer();
    const ctrl = new FlightLayerController({ viewer });
    expect(ctrl.getEntityCount()).toBe(0);

    ctrl.enqueueBatch({
      time: 1724580000,
      states: [
        {
          icao24: 'a00001',
          callsign: 'UAL123',
          origin_country: 'United States',
          time_position: 1724580000,
          last_contact: 1724580000,
          longitude: -122.4,
          latitude: 37.7,
          baro_altitude: 10000,
          on_ground: false,
          velocity: 250,
          true_track: 90,
          vertical_rate: 0,
          sensors: null,
          geo_altitude: 10200,
          squawk: '1200',
          spi: false,
          position_source: 0,
          category: 0,
        },
      ],
    });

    expect(ctrl.getEntityCount()).toBe(1);
    expect(ctrl.getFlightIds()).toContain('a00001');
    ctrl.destroy();
  });

  it('MarineLayerController: mounts datasource and enqueues AIS ship states', () => {
    const viewer = createMockViewer();
    const ctrl = new MarineLayerController({ viewer });
    expect(ctrl.getEntityCount()).toBe(0);

    ctrl.enqueueBatch({
      time: 1724580000,
      ships: [
        {
          mmsi: '367714520',
          name: 'PACIFIC HORIZON',
          callsign: 'WDJ3921',
          ship_type: 'Cargo',
          nav_status: 'Underway Using Engine',
          longitude: -122.3,
          latitude: 37.8,
          sog_knots: 14.5,
          cog_deg: 240,
          heading_deg: 242,
          destination: 'US OAK',
          eta: null,
          last_contact: 1724580000,
        },
      ],
    });

    expect(ctrl.getEntityCount()).toBe(1);
    expect(ctrl.getShipIds()).toContain('367714520');
    ctrl.destroy();
  });

  it('QuakeLayerController: mounts datasource and enqueues USGS quakes', () => {
    const viewer = createMockViewer();
    const ctrl = new QuakeLayerController({ viewer });
    expect(ctrl.getEntityCount()).toBe(0);

    ctrl.enqueueCollection({
      time: 1724580000,
      count: 1,
      features: [
        {
          id: 'nc75001234',
          mag: 3.4,
          place: '5 km NW of The Geysers, CA',
          time: 1724580000000,
          longitude: -122.8,
          latitude: 38.8,
          depth_km: 2.1,
          significance: 180,
          alert: 'green',
          tsunami: 0,
          status: 'reviewed',
        },
      ],
    });

    expect(ctrl.getEntityCount()).toBe(1);
    expect(ctrl.getQuakeIds()).toContain('nc75001234');
    ctrl.destroy();
  });

  it('FirmsLayerController: mounts datasource and enqueues FIRMS hotspots', () => {
    const viewer = createMockViewer();
    const ctrl = new FirmsLayerController({ viewer });
    expect(ctrl.getEntityCount()).toBe(0);

    ctrl.enqueueBatch({
      time: 1724580000,
      count: 1,
      hotspots: [
        {
          id: 'firms-1',
          longitude: -120.5,
          latitude: 36.2,
          brightness_kelvin: 345.2,
          frp_mw: 28.5,
          satellite: 'VIIRS_NOAA20',
          confidence: 'high',
          acq_date: '2026-08-26',
          acq_time: '1200',
          daynight: 'D',
        },
      ],
    });

    expect(ctrl.getEntityCount()).toBe(1);
    expect(ctrl.getHotspotIds()).toContain('firms-1');
    ctrl.destroy();
  });

  it('GbfsLayerController: mounts datasource and enqueues bike share stations', () => {
    const viewer = createMockViewer();
    const ctrl = new GbfsLayerController({ viewer });
    expect(ctrl.getEntityCount()).toBe(0);

    ctrl.enqueueBatch({
      time: 1724580000,
      system_id: 'baywheels',
      stations: [
        {
          station_id: 'bw-101',
          name: 'Market St at 4th St',
          longitude: -122.405,
          latitude: 37.785,
          capacity: 35,
          num_bikes_available: 12,
          num_docks_available: 23,
          is_installed: true,
          is_renting: true,
          is_returning: true,
        },
      ],
    });

    expect(ctrl.getEntityCount()).toBe(1);
    expect(ctrl.getStationIds()).toContain('bw-101');
    ctrl.destroy();
  });

  it('DebugBus: exposes flight entity counts and readiness', () => {
    const viewer = createMockViewer();
    const mockGlobe = {
      viewer,
      getSelectedEntity: () => null,
    } as unknown as GlobeController;

    const flight = new FlightLayerController({ viewer });
    const bus = attachDebugBus(mockGlobe, flight);

    expect(bus.getEntityCount()).toBe(0);
    expect(bus.isReady()).toBe(true);

    flight.destroy();
  });
});
