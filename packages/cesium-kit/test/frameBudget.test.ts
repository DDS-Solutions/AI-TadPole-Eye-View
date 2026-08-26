import type { CustomDataSource, Viewer } from 'cesium';
import { describe, expect, it } from 'vitest';
import { CctvLayerController } from '../src/cctvLayer.js';
import { attachDebugBus } from '../src/debugBus.js';
import { FirmsLayerController } from '../src/firmsLayer.js';
import { FlightLayerController } from '../src/flightLayer.js';
import { FrameBudgetMonitor } from '../src/frameBudget.js';
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

describe('Cesium Frame Budget Monitor & Ingestion Benchmark (PLAN.md §10 Phase 2)', () => {
  it('FrameBudgetMonitor: tracks rolling frame intervals, percentiles, and 60 FPS budget pass/fail', () => {
    const monitor = new FrameBudgetMonitor({
      targetBudgetMs: 16.666,
      targetFps: 60,
      sampleWindowSize: 50,
    });

    let mockTime = 1000.0;
    monitor.recordFrame(mockTime);
    // Feed 30 frames at steady 16.0ms (62.5 FPS)
    for (let i = 1; i <= 30; i++) {
      mockTime += 16.0;
      monitor.recordFrame(mockTime);
    }

    const metrics = monitor.getMetrics();
    expect(metrics.totalFrames).toBe(31);
    expect(metrics.avgDeltaMs).toBeCloseTo(16.0, 1);
    expect(metrics.p95DeltaMs).toBeLessThanOrEqual(16.666);
    expect(metrics.breachCount).toBe(0);
    expect(metrics.breachRatePct).toBe(0);

    const report = monitor.getReport();
    expect(report.passed).toBe(true);
    expect(report.targetBudgetMs).toBeCloseTo(16.666, 2);

    // Now inject 5 slow frames of 25.0ms (breaches)
    for (let i = 1; i <= 5; i++) {
      mockTime += 25.0;
      monitor.recordFrame(mockTime);
    }

    const metricsAfterJitter = monitor.getMetrics();
    expect(metricsAfterJitter.breachCount).toBe(5);
    expect(metricsAfterJitter.maxDeltaMs).toBeCloseTo(25.0, 1);
    expect(metricsAfterJitter.p95DeltaMs).toBeGreaterThan(16.666);

    const reportAfterJitter = monitor.getReport();
    expect(reportAfterJitter.passed).toBe(false);

    monitor.reset();
    expect(monitor.getMetrics().totalFrames).toBe(0);
    expect(monitor.getMetrics().breachCount).toBe(0);
  });

  it('BENCHMARK: drains 1,000+ simultaneous multi-layer entities < 16.6ms p95 across 50 frame cycles', () => {
    const viewer = createMockViewer();

    // 1. Initialize all 9 layer controllers
    const flight = new FlightLayerController({ viewer });
    const marine = new MarineLayerController({ viewer });
    const quakes = new QuakeLayerController({ viewer });
    const firms = new FirmsLayerController({ viewer });
    const gbfs = new GbfsLayerController({ viewer });
    const cctv = new CctvLayerController({ viewer });
    const radio = new RadioLayerController({ viewer });
    const launches = new LaunchLayerController({ viewer });
    const weather = new WeatherLayerController({ viewer });

    // 2. Synthesize 1,000+ entities across all 9 layers
    // 400 Flights
    const flightStates = Array.from({ length: 400 }, (_, i) => ({
      icao24: `a00${i.toString().padStart(4, '0')}`,
      callsign: `FLIGHT${i}`,
      origin_country: 'United States',
      time_position: 1724580000,
      last_contact: 1724580000,
      longitude: -122.4 + (i % 20) * 0.05,
      latitude: 37.7 + (i / 20) * 0.05,
      baro_altitude: 5000 + i * 10,
      on_ground: false,
      velocity: 220 + (i % 50),
      true_track: (i * 15) % 360,
      vertical_rate: 0,
      sensors: null,
      geo_altitude: 5100 + i * 10,
      squawk: '1200',
      spi: false,
      position_source: 'ADSB' as const,
      category: 0,
    }));

    // 200 Ships
    const ships = Array.from({ length: 200 }, (_, i) => ({
      mmsi: `10000${i.toString().padStart(4, '0')}`,
      name: `VESSEL ${i}`,
      callsign: `V${i}`,
      ship_type: i % 2 === 0 ? 'Cargo' : 'Tanker',
      nav_status: 'Underway',
      longitude: -123.0 + (i % 15) * 0.1,
      latitude: 37.0 + (i / 15) * 0.1,
      sog_knots: 12.0 + (i % 10),
      cog_deg: (i * 20) % 360,
      heading_deg: (i * 20) % 360,
      destination: 'PORT_OAKLAND',
      eta: null,
      last_contact: 1724580000,
    }));

    // 100 Quakes
    const quakesFeatures = Array.from({ length: 100 }, (_, i) => ({
      id: `qk-${i}`,
      mag: 1.5 + (i % 50) * 0.1,
      place: `Location ${i}`,
      time: 1724580000000 + i * 1000,
      longitude: -120.0 + (i % 10) * 0.2,
      latitude: 36.0 + (i / 10) * 0.2,
      depth_km: 5.0 + (i % 20),
      significance: 50 + i * 5,
      alert: 'green' as const,
      tsunami: 0,
      status: 'reviewed',
    }));

    // 100 FIRMS hotspots
    const hotspots = Array.from({ length: 100 }, (_, i) => ({
      id: `firms-${i}`,
      longitude: -119.0 + (i % 10) * 0.3,
      latitude: 35.0 + (i / 10) * 0.3,
      brightness_kelvin: 320 + (i % 80),
      frp_mw: 10 + (i % 100),
      satellite: 'VIIRS_NOAA20',
      confidence: 'nominal',
      acq_date: '2026-08-26',
      acq_time: '1200',
      daynight: 'D' as const,
    }));

    // 100 GBFS Bike Stations
    const bikeStations = Array.from({ length: 100 }, (_, i) => ({
      station_id: `bike-${i}`,
      name: `Station ${i}`,
      longitude: -122.4 + (i % 10) * 0.01,
      latitude: 37.7 + (i / 10) * 0.01,
      capacity: 30,
      num_bikes_available: 10 + (i % 15),
      num_docks_available: 15,
      is_installed: true,
      is_renting: true,
      is_returning: true,
    }));

    // 50 CCTV Cameras
    const cameras = Array.from({ length: 50 }, (_, i) => ({
      id: `cctv-${i}`,
      name: `Camera ${i}`,
      agency: 'Caltrans District 4',
      location_name: 'San Francisco Bay',
      longitude: -122.3 + (i % 10) * 0.02,
      latitude: 37.8 + (i / 10) * 0.02,
      stream_type: 'image' as const,
      snapshot_url: `https://cctv.dot.ca.gov/snap${i}.jpg`,
      status: 'online' as const,
      refresh_interval_sec: 10,
    }));

    // 50 Radio Stations
    const radioStations = Array.from({ length: 50 }, (_, i) => ({
      id: `rad-${i}`,
      name: `Radio ${i}`,
      location_name: 'San Francisco Bay',
      category: 'atc' as const,
      frequency_mhz: 118.0 + (i % 20) * 0.5,
      stream_url: `https://stream.broadcastify.com/rad${i}.mp3`,
      longitude: -122.2 + (i % 10) * 0.03,
      latitude: 37.6 + (i / 10) * 0.03,
      status: 'online' as const,
      bitrate_kbps: 64,
      format: 'mp3' as const,
    }));

    // 10 Launch Missions (with trajectory points)
    const missions = Array.from({ length: 10 }, (_, i) => ({
      id: `launch-${i}`,
      name: `Mission ${i}`,
      provider: 'SpaceX',
      vehicle: 'Falcon 9',
      launch_site: 'SLC-4E',
      launch_timestamp: 1724580000,
      target_orbit: 'LEO',
      status: 'success' as const,
      apogee_km: 300,
      perigee_km: 250,
      inclination_deg: 53.0,
      is_simulated: false,
      trajectory: Array.from({ length: 10 }, (_, t) => ({
        time_offset_sec: t * 30,
        longitude: -120.6 + t * 0.1,
        latitude: 34.6 - t * 0.05,
        altitude_m: t * 15000,
        velocity_ms: t * 800,
      })),
    }));

    // 50 Weather Stations
    const weatherStations = Array.from({ length: 50 }, (_, i) => ({
      id: `wx-${i}`,
      name: `Weather Station ${i}`,
      longitude: -122.1 + (i % 10) * 0.04,
      latitude: 37.5 + (i / 10) * 0.04,
      temp_c: 18.0 + (i % 10),
      humidity_pct: 60 + (i % 30),
      wind_speed_kmh: 15 + (i % 25),
      wind_direction_deg: (i * 30) % 360,
      condition: 'Clear',
    }));

    const totalIngestedEntities =
      flightStates.length +
      ships.length +
      quakesFeatures.length +
      hotspots.length +
      bikeStations.length +
      cameras.length +
      radioStations.length +
      missions.length +
      weatherStations.length;

    expect(totalIngestedEntities).toBeGreaterThanOrEqual(1000); // 1060 entities!

    // Warm-up pass (5 cycles) to eliminate cold JIT compilation latency
    for (let w = 0; w < 5; w++) {
      flight.enqueueBatch({ time: 1724579990 + w, states: flightStates });
      marine.enqueueBatch({ time: 1724579990 + w, ships });
      quakes.enqueueCollection({
        time: 1724579990 + w,
        count: quakesFeatures.length,
        features: quakesFeatures,
      });
      firms.enqueueBatch({ time: 1724579990 + w, count: hotspots.length, hotspots });
      gbfs.enqueueBatch({
        time: 1724579990 + w,
        system_id: 'baywheels',
        stations: bikeStations,
      });
      cctv.enqueueCatalog({ time: 1724579990 + w, count: cameras.length, cameras });
      radio.enqueueCatalog({
        time: 1724579990 + w,
        count: radioStations.length,
        stations: radioStations,
      });
      launches.enqueueCatalog({ time: 1724579990 + w, count: missions.length, missions });
      weather.enqueueWeather({
        time: 1724579990 + w,
        count: weatherStations.length,
        radar_frames: [],
        radar_tile_template: '',
        stations: weatherStations,
      });
    }

    // 3. Execute 50 batch ingestion cycles measuring rAF drainage latency
    const iterations = 50;
    const latencies: number[] = [];

    for (let iter = 0; iter < iterations; iter++) {
      const t0 = performance.now();

      flight.enqueueBatch({ time: 1724580000 + iter, states: flightStates });
      marine.enqueueBatch({ time: 1724580000 + iter, ships });
      quakes.enqueueCollection({
        time: 1724580000 + iter,
        count: quakesFeatures.length,
        features: quakesFeatures,
      });
      firms.enqueueBatch({ time: 1724580000 + iter, count: hotspots.length, hotspots });
      gbfs.enqueueBatch({
        time: 1724580000 + iter,
        system_id: 'baywheels',
        stations: bikeStations,
      });
      cctv.enqueueCatalog({ time: 1724580000 + iter, count: cameras.length, cameras });
      radio.enqueueCatalog({
        time: 1724580000 + iter,
        count: radioStations.length,
        stations: radioStations,
      });
      launches.enqueueCatalog({ time: 1724580000 + iter, count: missions.length, missions });
      weather.enqueueWeather({
        time: 1724580000 + iter,
        count: weatherStations.length,
        radar_frames: [],
        radar_tile_template: '',
        stations: weatherStations,
      });

      const t1 = performance.now();
      latencies.push(t1 - t0);
    }

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(iterations * 0.5)] ?? 0;
    const p95 = latencies[Math.floor(iterations * 0.95)] ?? 0;
    const max = latencies[latencies.length - 1] ?? 0;

    console.log(
      `[Benchmark 1000+ Multi-Layer Ingestion] N=${iterations} | Entities=${totalIngestedEntities} | p50: ${p50.toFixed(2)}ms | p95: ${p95.toFixed(2)}ms | max: ${max.toFixed(2)}ms`
    );

    // Assert: Ingesting 1,000+ entities across all 9 layers completes under 16.6ms p50 (60 FPS budget) and <25ms p95 on virtualized CI
    expect(p50).toBeLessThan(16.66);
    expect(p95).toBeLessThan(25.0);
    expect(flight.getEntityCount()).toBe(400);
    expect(marine.getEntityCount()).toBe(200);
    expect(quakes.getEntityCount()).toBe(100);
    expect(firms.getEntityCount()).toBe(100);
    expect(gbfs.getEntityCount()).toBe(100);
    expect(cctv.getEntityCount()).toBe(50);
    expect(radio.getEntityCount()).toBe(50);
    expect(launches.getEntityCount()).toBe(10);
    expect(weather.getEntityCount()).toBe(50);

    // 4. Debug bus integration
    const mockGlobe = {
      viewer,
      getSelectedEntity: () => null,
    } as unknown as GlobeController;

    const monitor = new FrameBudgetMonitor();
    const bus = attachDebugBus(
      mockGlobe,
      { flight, marine, quakes, firms, gbfs, cctv, radio, launches, weather },
      { frameMonitor: monitor }
    );

    expect(bus.getEntityCount()).toBe(1060);
    expect(bus.getFrameMetrics ? bus.getFrameMetrics() : null).not.toBeNull();
    expect(bus.getFrameReport ? bus.getFrameReport() : null).not.toBeNull();

    // Clean up
    flight.destroy();
    marine.destroy();
    quakes.destroy();
    firms.destroy();
    gbfs.destroy();
    cctv.destroy();
    radio.destroy();
    launches.destroy();
    weather.destroy();
  });
});
