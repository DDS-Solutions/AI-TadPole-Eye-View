import type { CustomDataSource, Viewer } from 'cesium';
import { describe, expect, it } from 'vitest';
import { CctvLayerController } from '../src/cctvLayer.js';
import { attachDebugBus } from '../src/debugBus.js';
import { FirmsLayerController } from '../src/firmsLayer.js';
import { FlightLayerController } from '../src/flightLayer.js';
import { GbfsLayerController } from '../src/gbfsLayer.js';
import type { GlobeController } from '../src/globe.js';
import { LaunchLayerController } from '../src/launchLayer.js';
import { MarineLayerController } from '../src/marineLayer.js';
import { QuakeLayerController } from '../src/quakeLayer.js';
import { RadioLayerController } from '../src/radioLayer.js';
import { WeatherLayerController } from '../src/weatherLayer.js';

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

describe('Cesium Kit Telemetry Layer Controllers (PLAN.md §8)', () => {
  it('FlightLayerController: enqueues and drains aircraft batches', () => {
    const viewer = createMockViewer();
    const flightLayer = new FlightLayerController({ viewer });

    flightLayer.enqueueBatch({
      time: 1724580000,
      states: [
        {
          icao24: 'a00001',
          callsign: 'UAL123',
          origin_country: 'United States',
          time_position: 1724580000,
          last_contact: 1724580000,
          longitude: -122.4194,
          latitude: 37.7749,
          baro_altitude: 10000,
          on_ground: false,
          velocity: 250,
          true_track: 180,
          vertical_rate: 0,
          sensors: null,
          geo_altitude: 10100,
          squawk: '1200',
          spi: false,
          position_source: 0,
          category: 0,
        },
      ],
    });

    expect(flightLayer.getEntityCount()).toBe(1);
    expect(flightLayer.getFlightIds()).toContain('a00001');

    flightLayer.destroy();
    expect(flightLayer.getEntityCount()).toBe(0);
  });

  it('MarineLayerController: enqueues AIS vessels, filters by ship type, and toggles visibility', () => {
    const viewer = createMockViewer();
    const marineLayer = new MarineLayerController({ viewer });

    marineLayer.enqueueBatch({
      time: 1724580000,
      ships: [
        {
          mmsi: '123456789',
          name: 'PACIFIC CARGO',
          callsign: 'WDC123',
          ship_type: 'Cargo',
          nav_status: 'Underway',
          longitude: -122.4,
          latitude: 37.8,
          sog_knots: 14.5,
          cog_deg: 240,
          heading_deg: 242,
          destination: 'OAKLAND',
          eta: '2026-08-26T18:00:00Z',
          last_contact: 1724580000,
        },
        {
          mmsi: '987654321',
          name: 'BAY TANKER',
          callsign: 'WDC999',
          ship_type: 'Tanker',
          nav_status: 'Moored',
          longitude: -122.3,
          latitude: 37.9,
          sog_knots: 0.1,
          cog_deg: 0,
          heading_deg: 180,
          destination: 'RICHMOND',
          eta: null,
          last_contact: 1724580000,
        },
      ],
    });

    expect(marineLayer.getEntityCount()).toBe(2);
    expect(marineLayer.getShipIds()).toEqual(['123456789', '987654321']);

    marineLayer.setVesselTypeFilter('tanker');
    expect(marineLayer.dataSource.entities.getById('ship-987654321')?.show).toBe(true);
    expect(marineLayer.dataSource.entities.getById('ship-123456789')?.show).toBe(false);

    marineLayer.setVisible(false);
    expect(marineLayer.dataSource.show).toBe(false);

    marineLayer.destroy();
    expect(marineLayer.getEntityCount()).toBe(0);
  });

  it('QuakeLayerController: scales by magnitude and filters hypocenters', () => {
    const viewer = createMockViewer();
    const quakeLayer = new QuakeLayerController({ viewer });

    quakeLayer.enqueueCollection({
      time: 1724580000,
      count: 2,
      features: [
        {
          id: 'nc75001',
          mag: 2.7,
          place: '10km NE of Berkeley, CA',
          time: 1724580000000,
          longitude: -122.2,
          latitude: 37.9,
          depth_km: 8.5,
          significance: 110,
          alert: 'green',
          tsunami: 0,
          status: 'reviewed',
        },
        {
          id: 'nc75002',
          mag: 5.8,
          place: '25km SW of Eureka, CA',
          time: 1724580000000,
          longitude: -124.3,
          latitude: 40.5,
          depth_km: 15.2,
          significance: 600,
          alert: 'yellow',
          tsunami: 1,
          status: 'reviewed',
        },
      ],
    });

    expect(quakeLayer.getEntityCount()).toBe(2);
    expect(quakeLayer.getQuakeIds()).toEqual(['nc75001', 'nc75002']);

    quakeLayer.setMinMagnitude(4.5);
    expect(quakeLayer.dataSource.entities.getById('quake-nc75001')?.show).toBe(false);
    expect(quakeLayer.dataSource.entities.getById('quake-nc75002')?.show).toBe(true);

    quakeLayer.destroy();
    expect(quakeLayer.getEntityCount()).toBe(0);
  });

  it('FirmsLayerController: filters by Fire Radiative Power (FRP) and confidence', () => {
    const viewer = createMockViewer();
    const firmsLayer = new FirmsLayerController({ viewer });

    firmsLayer.enqueueBatch({
      time: 1724580000,
      count: 2,
      hotspots: [
        {
          id: 'firms-01',
          longitude: -121.5,
          latitude: 38.5,
          brightness_kelvin: 335.5,
          frp_mw: 12.4,
          satellite: 'VIIRS_NOAA20',
          confidence: 'nominal',
          acq_date: '2026-08-26',
          acq_time: '1830',
          daynight: 'D',
        },
        {
          id: 'firms-02',
          longitude: -120.5,
          latitude: 39.1,
          brightness_kelvin: 390.2,
          frp_mw: 85.0,
          satellite: 'VIIRS_SNPP',
          confidence: 'high',
          acq_date: '2026-08-26',
          acq_time: '1830',
          daynight: 'D',
        },
      ],
    });

    expect(firmsLayer.getEntityCount()).toBe(2);

    firmsLayer.setMinFrp(50);
    expect(firmsLayer.dataSource.entities.getById('firms-firms-01')?.show).toBe(false);
    expect(firmsLayer.dataSource.entities.getById('firms-firms-02')?.show).toBe(true);

    firmsLayer.setConfidenceFilter('high');
    expect(firmsLayer.dataSource.entities.getById('firms-firms-02')?.show).toBe(true);

    firmsLayer.destroy();
    expect(firmsLayer.getEntityCount()).toBe(0);
  });

  it('GbfsLayerController: manages bikeshare station capacity visualizer', () => {
    const viewer = createMockViewer();
    const gbfsLayer = new GbfsLayerController({ viewer });

    gbfsLayer.enqueueBatch({
      time: 1724580000,
      system_id: 'baywheels',
      stations: [
        {
          station_id: 'sf-market-1',
          name: 'Market St at 4th St',
          longitude: -122.404,
          latitude: 37.786,
          capacity: 35,
          num_bikes_available: 12,
          num_docks_available: 23,
          is_installed: true,
          is_renting: true,
          is_returning: true,
        },
        {
          station_id: 'sf-market-2',
          name: 'Market St at 10th St',
          longitude: -122.417,
          latitude: 37.777,
          capacity: 25,
          num_bikes_available: 0,
          num_docks_available: 25,
          is_installed: true,
          is_renting: true,
          is_returning: true,
        },
      ],
    });

    expect(gbfsLayer.getEntityCount()).toBe(2);
    expect(gbfsLayer.getStationIds()).toContain('sf-market-1');

    gbfsLayer.setMinBikesAvailable(5);
    expect(gbfsLayer.dataSource.entities.getById('gbfs-sf-market-2')?.show).toBe(false);
    expect(gbfsLayer.dataSource.entities.getById('gbfs-sf-market-1')?.show).toBe(true);

    gbfsLayer.destroy();
    expect(gbfsLayer.getEntityCount()).toBe(0);
  });

  it('CctvLayerController: manages DOT camera markers and agency filtering', () => {
    const viewer = createMockViewer();
    const cctvLayer = new CctvLayerController({ viewer });

    cctvLayer.enqueueCatalog({
      time: 1724580000,
      count: 2,
      cameras: [
        {
          id: 'caltrans-d4-baybridge',
          name: 'I-80 Bay Bridge West Span',
          agency: 'Caltrans District 4',
          longitude: -122.38,
          latitude: 37.79,
          stream_type: 'image',
          snapshot_url: 'https://cctv.dot.ca.gov/snapshot1.jpg',
          status: 'online',
          refresh_interval_sec: 10,
        },
        {
          id: 'nycdot-fdr-42st',
          name: 'FDR Drive at 42nd St',
          agency: 'NYCDOT',
          longitude: -73.96,
          latitude: 40.75,
          stream_type: 'image',
          snapshot_url: 'https://nyctmc.org/snapshot2.jpg',
          status: 'online',
          refresh_interval_sec: 10,
        },
      ],
    });

    expect(cctvLayer.getEntityCount()).toBe(2);
    expect(cctvLayer.getCameraIds()).toContain('caltrans-d4-baybridge');

    cctvLayer.setAgencyFilter('caltrans');
    expect(cctvLayer.dataSource.entities.getById('cctv-caltrans-d4-baybridge')?.show).toBe(true);
    expect(cctvLayer.dataSource.entities.getById('cctv-nycdot-fdr-42st')?.show).toBe(false);

    cctvLayer.destroy();
    expect(cctvLayer.getEntityCount()).toBe(0);
  });

  it('RadioLayerController: manages radio frequencies and category filtering', () => {
    const viewer = createMockViewer();
    const radioLayer = new RadioLayerController({ viewer });

    radioLayer.enqueueCatalog({
      time: 1724580000,
      count: 2,
      stations: [
        {
          id: 'ksfo-tower',
          name: 'KSFO Tower',
          category: 'atc',
          frequency_mhz: 120.5,
          stream_url: 'https://stream.broadcastify.com/ksfo.mp3',
          longitude: -122.375,
          latitude: 37.619,
          status: 'online',
          bitrate_kbps: 64,
          format: 'mp3',
        },
        {
          id: 'norcal-marine-ch16',
          name: 'SF Bay Marine Distress Ch 16',
          category: 'marine',
          frequency_mhz: 156.8,
          stream_url: 'https://stream.broadcastify.com/marine16.mp3',
          longitude: -122.42,
          latitude: 37.81,
          status: 'online',
          bitrate_kbps: 64,
          format: 'mp3',
        },
      ],
    });

    expect(radioLayer.getEntityCount()).toBe(2);
    expect(radioLayer.getStationIds()).toContain('ksfo-tower');

    radioLayer.setCategoryFilter('atc');
    expect(radioLayer.dataSource.entities.getById('radio-ksfo-tower')?.show).toBe(true);
    expect(radioLayer.dataSource.entities.getById('radio-norcal-marine-ch16')?.show).toBe(false);

    radioLayer.destroy();
    expect(radioLayer.getEntityCount()).toBe(0);
  });

  it('LaunchLayerController: renders trajectory polylines and mission telemetry', () => {
    const viewer = createMockViewer();
    const launchLayer = new LaunchLayerController({ viewer });

    launchLayer.enqueueCatalog({
      time: 1724580000,
      count: 1,
      missions: [
        {
          id: 'mission-f9-test',
          name: 'Falcon 9 • Starlink Test',
          provider: 'SpaceX',
          vehicle: 'Falcon 9',
          launch_site: 'Vandenberg SLC-4E',
          launch_timestamp: 1724580000,
          target_orbit: 'LEO',
          status: 'success',
          apogee_km: 300,
          perigee_km: 290,
          inclination_deg: 53.0,
          is_simulated: false,
          trajectory: [
            {
              time_offset_sec: 0,
              longitude: -120.6,
              latitude: 34.6,
              altitude_m: 0,
              velocity_ms: 0,
            },
            {
              time_offset_sec: 120,
              longitude: -120.7,
              latitude: 34.0,
              altitude_m: 45000,
              velocity_ms: 1500,
            },
          ],
        },
      ],
    });

    expect(launchLayer.getEntityCount()).toBe(1);
    expect(launchLayer.getMissionIds()).toContain('mission-f9-test');

    launchLayer.destroy();
    expect(launchLayer.getEntityCount()).toBe(0);
  });

  it('WeatherLayerController: renders weather observations and stations', () => {
    const viewer = createMockViewer();
    const weatherLayer = new WeatherLayerController({ viewer });

    weatherLayer.enqueueWeather({
      time: 1724580000,
      count: 1,
      radar_frames: [],
      radar_tile_template: 'https://tilecache.rainviewer.com{path}',
      stations: [
        {
          id: 'wx-ksfo-obs',
          name: 'San Francisco Int Airport',
          longitude: -122.375,
          latitude: 37.619,
          temp_c: 18.2,
          humidity_pct: 70,
          wind_speed_kmh: 20,
          wind_direction_deg: 270,
          condition: 'Clear',
        },
      ],
    });

    expect(weatherLayer.getEntityCount()).toBe(1);
    expect(weatherLayer.getStationIds()).toContain('wx-ksfo-obs');

    weatherLayer.destroy();
    expect(weatherLayer.getEntityCount()).toBe(0);
  });

  it('attachDebugBus: provides complete implemented-layer counts and telemetry introspection', () => {
    const viewer = createMockViewer();
    const mockGlobe = {
      viewer,
      getSelectedEntity: () => null,
    } as unknown as GlobeController;

    const flight = new FlightLayerController({ viewer });
    const marine = new MarineLayerController({ viewer });
    const quakes = new QuakeLayerController({ viewer });
    const firms = new FirmsLayerController({ viewer });
    const gbfs = new GbfsLayerController({ viewer });
    const cctv = new CctvLayerController({ viewer });
    const radio = new RadioLayerController({ viewer });
    const launches = new LaunchLayerController({ viewer });
    const weather = new WeatherLayerController({ viewer });

    const bus = attachDebugBus(mockGlobe, {
      flight,
      marine,
      quakes,
      firms,
      gbfs,
      cctv,
      radio,
      launches,
      weather,
    });

    expect(bus.isReady()).toBe(true);
    expect(bus.getEntityCount()).toBe(0);
    expect(bus.getLayerCounts()).toEqual({
      flights: 0,
      marine: 0,
      quakes: 0,
      firms: 0,
      gbfs: 0,
      cctv: 0,
      radio: 0,
      launches: 0,
      weather: 0,
      cables: 0,
      satellites: 0,
    });
  });
});
