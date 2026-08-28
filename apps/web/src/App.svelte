<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    GlobeController,
    FlightLayerController,
    MarineLayerController,
    QuakeLayerController,
    FirmsLayerController,
    GbfsLayerController,
    CctvLayerController,
    RadioLayerController,
    LaunchLayerController,
    WeatherLayerController,
    CollabLayerController,
    FrameBudgetMonitor,
    attachDebugBus,
  } from '@gev/cesium-kit';
  import type {
    FlightBatch,
    ShipBatch,
    EarthquakeCollection,
    ThermalHotspotBatch,
    BikeStationBatch,
    CctvCatalog,
    RadioCatalog,
    LaunchCatalog,
    WeatherCollection,
  } from '@gev/contracts';
  import { parseSceneFromUrl } from '@gev/core';
  import { layerStore } from './stores/layers.svelte.js';
  import { voiceStore } from './stores/voice.svelte.js';
  import { collabStore } from './stores/collab.svelte.js';
  import { runtimeClock } from './runtimeClock.js';
  import HudHeader from './components/HudHeader.svelte';
  import LayerControlPanel from './components/LayerControlPanel.svelte';
  import EntityInfoCard from './components/EntityInfoCard.svelte';
  import VirtualizedTelemetryTable from './components/VirtualizedTelemetryTable.svelte';
  import VoiceControlOrb from './components/VoiceControlOrb.svelte';
  import CollabBar from './components/CollabBar.svelte';
  import { JulianDate, type Entity } from 'cesium';

  let globeContainer: HTMLDivElement;
  let globe: GlobeController | null = null;
  let frameMonitor: FrameBudgetMonitor | null = null;

  let flightLayer: FlightLayerController | null = null;
  let marineLayer: MarineLayerController | null = null;
  let quakeLayer: QuakeLayerController | null = null;
  let firmsLayer: FirmsLayerController | null = null;
  let gbfsLayer: GbfsLayerController | null = null;
  let cctvLayer: CctvLayerController | null = null;
  let radioLayer: RadioLayerController | null = null;
  let launchLayer: LaunchLayerController | null = null;
  let weatherLayer: WeatherLayerController | null = null;
  let collabLayer: CollabLayerController | null = null;

  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let abortController: AbortController | null = null;

  async function pollAllFeeds() {
    abortController?.abort();
    abortController = new AbortController();
    const signal = abortController.signal;

    try {
      // 1. Flights
      if (layerStore.visibility.flights) {
        fetch('/api/flights', { signal })
          .then((res) => (res.ok ? res.json() : null))
          .then((data: FlightBatch | null) => {
            if (data && flightLayer) {
              flightLayer.enqueueBatch(data);
              layerStore.counts.flights = flightLayer.getEntityCount();
              layerStore.rawEntities.flights = data.states;
            }
          })
          .catch((err) => {
            if (err.name !== 'AbortError') {
              layerStore.activeErrors.flights = String(err);
            }
          });
      }

      // 2. Ships (AIS)
      if (layerStore.visibility.marine) {
        fetch('/api/ships', { signal })
          .then((res) => (res.ok ? res.json() : null))
          .then((data: ShipBatch | null) => {
            if (data && marineLayer) {
              marineLayer.enqueueBatch(data);
              layerStore.counts.marine = marineLayer.getEntityCount();
              layerStore.rawEntities.marine = data.ships;
            }
          })
          .catch((err) => {
            if (err.name !== 'AbortError') {
              layerStore.activeErrors.marine = String(err);
            }
          });
      }

      // 3. Earthquakes (USGS)
      if (layerStore.visibility.quakes) {
        fetch('/api/quakes', { signal })
          .then((res) => (res.ok ? res.json() : null))
          .then((data: EarthquakeCollection | null) => {
            if (data && quakeLayer) {
              quakeLayer.enqueueCollection(data);
              layerStore.counts.quakes = quakeLayer.getEntityCount();
              layerStore.rawEntities.quakes = data.features;
            }
          })
          .catch((err) => {
            if (err.name !== 'AbortError') {
              layerStore.activeErrors.quakes = String(err);
            }
          });
      }

      // 4. Thermal Hotspots (NASA FIRMS)
      if (layerStore.visibility.firms) {
        fetch('/api/firms', { signal })
          .then((res) => (res.ok ? res.json() : null))
          .then((data: ThermalHotspotBatch | null) => {
            if (data && firmsLayer) {
              firmsLayer.enqueueBatch(data);
              layerStore.counts.firms = firmsLayer.getEntityCount();
              layerStore.rawEntities.firms = data.hotspots;
            }
          })
          .catch((err) => {
            if (err.name !== 'AbortError') {
              layerStore.activeErrors.firms = String(err);
            }
          });
      }

      // 5. Shared Transit (GBFS)
      if (layerStore.visibility.gbfs) {
        fetch('/api/gbfs', { signal })
          .then((res) => (res.ok ? res.json() : null))
          .then((data: BikeStationBatch | null) => {
            if (data && gbfsLayer) {
              gbfsLayer.enqueueBatch(data);
              layerStore.counts.gbfs = gbfsLayer.getEntityCount();
              layerStore.rawEntities.gbfs = data.stations;
            }
          })
          .catch((err) => {
            if (err.name !== 'AbortError') {
              layerStore.activeErrors.gbfs = String(err);
            }
          });
      }

      // 6. Public CCTV Media
      if (layerStore.visibility.cctv) {
        fetch('/api/cctv/catalog', { signal })
          .then((res) => (res.ok ? res.json() : null))
          .then((data: CctvCatalog | null) => {
            if (data && cctvLayer) {
              cctvLayer.enqueueCatalog(data);
              layerStore.counts.cctv = cctvLayer.getEntityCount();
              layerStore.rawEntities.cctv = data.cameras;
            }
          })
          .catch((err) => {
            if (err.name !== 'AbortError') {
              layerStore.activeErrors.cctv = String(err);
            }
          });
      }

      // 7. Global Radio Broadcasts
      if (layerStore.visibility.radio) {
        fetch('/api/radio/catalog', { signal })
          .then((res) => (res.ok ? res.json() : null))
          .then((data: RadioCatalog | null) => {
            if (data && radioLayer) {
              radioLayer.enqueueCatalog(data);
              layerStore.counts.radio = radioLayer.getEntityCount();
              layerStore.rawEntities.radio = data.stations;
            }
          })
          .catch((err) => {
            if (err.name !== 'AbortError') {
              layerStore.activeErrors.radio = String(err);
            }
          });
      }

      // 8. Orbital Launches
      if (layerStore.visibility.launches) {
        fetch('/api/launches', { signal })
          .then((res) => (res.ok ? res.json() : null))
          .then((data: LaunchCatalog | null) => {
            if (data && launchLayer) {
              launchLayer.enqueueCatalog(data);
              layerStore.counts.launches = launchLayer.getEntityCount();
              layerStore.rawEntities.launches = data.missions;
            }
          })
          .catch((err) => {
            if (err.name !== 'AbortError') {
              layerStore.activeErrors.launches = String(err);
            }
          });
      }

      // 9. Weather Radar & Precipitation
      if (layerStore.visibility.weather) {
        fetch('/api/weather/radar', { signal })
          .then((res) => (res.ok ? res.json() : null))
          .then((data: WeatherCollection | null) => {
            if (data && weatherLayer) {
              weatherLayer.enqueueCollection(data);
              layerStore.counts.weather = weatherLayer.getEntityCount();
              layerStore.rawEntities.weather = data.stations;
            }
          })
          .catch((err) => {
            if (err.name !== 'AbortError') {
              layerStore.activeErrors.weather = String(err);
            }
          });
      }
    } catch {
      // Catch network or parsing errors
    }
  }

  function handleEntitySelected(entity: Entity | null) {
    if (!entity) {
      layerStore.clearSelection();
      collabStore.syncSelectedEntity(null);
      return;
    }

    const props: Record<string, unknown> = {};
    if (entity.properties) {
      const propertyNames = entity.properties.propertyNames;
      const now = JulianDate.fromIso8601(runtimeClock.iso());
      for (const name of propertyNames) {
        props[name] = entity.properties.getValue(now)?.[name];
      }
    }

    const kind =
      (props.entityKind as
        | 'flight'
        | 'marine'
        | 'quake'
        | 'firms'
        | 'gbfs'
        | 'cctv'
        | 'radio'
        | 'launch'
        | 'weather') || 'flight';

    layerStore.selectEntity({
      kind,
      id: String(entity.id),
      name: String(entity.name || entity.id),
      data: props,
    });

    collabStore.syncSelectedEntity({ layer: kind, id: String(entity.id) });
  }

  // Register Voice / Co-User Tool Actuators
  function setupToolExecutors() {
    voiceStore.executor.register('fly_to_location', (input) => {
      if (globe) {
        globe.flyToLocation(input.lat, input.lon, input.altitude_m, input.duration_s);
      }
      return {
        moved: true,
        target: {
          lat: input.lat,
          lon: input.lon,
          altitude_m: input.altitude_m ?? 500000,
        },
      };
    });

    voiceStore.executor.register('toggle_layer', (input) => {
      const key = input.layer as keyof typeof layerStore.visibility;
      if (key in layerStore.visibility) {
        layerStore.visibility[key] = input.enabled;
        collabStore.syncLayerToggle(input.layer, input.enabled);
        return { layer: input.layer, enabled: input.enabled, updated: true };
      }
      return { layer: input.layer, enabled: input.enabled, updated: false };
    });

    voiceStore.executor.register('select_entity', (input) => {
      const key = input.layer as keyof typeof layerStore.rawEntities;
      const list = (layerStore.rawEntities[key] || []) as Array<Record<string, unknown>>;
      const found = list.find((item) => String(item.id || item.icao24 || item.mmsi || item.station_id) === input.id);
      if (found) {
        layerStore.selectEntity({
          kind: input.layer as any,
          id: input.id,
          name: String(found.name || found.callsign || input.id),
          data: found,
        });
        if (input.track_camera && globe && typeof found.latitude === 'number' && typeof found.longitude === 'number') {
          globe.flyToLocation(found.latitude, found.longitude, 50000, 2);
        }
        return { selected: true, layer: input.layer, id: input.id, entity_found: true };
      }
      return { selected: false, layer: input.layer, id: input.id, entity_found: false };
    });

    voiceStore.executor.register('inspect_telemetry', (input) => {
      const key = input.layer as keyof typeof layerStore.rawEntities;
      const list = (layerStore.rawEntities[key] || []) as Array<Record<string, unknown>>;
      const found = list.find((item) => String(item.id || item.icao24 || item.mmsi || item.station_id) === input.id);
      return {
        layer: input.layer,
        id: input.id,
        found: Boolean(found),
        data: found,
      };
    });

    voiceStore.executor.register('query_aoi', (input) => {
      const counts: Record<string, number> = {};
      let total = 0;
      for (const [layer, list] of Object.entries(layerStore.rawEntities)) {
        if (!input.layers || input.layers.includes(layer)) {
          const inBounds = (list as Array<Record<string, unknown>>).filter((item) => {
            const lat = Number(item.latitude || item.lat);
            const lon = Number(item.longitude || item.lon);
            return lat >= input.south && lat <= input.north && lon >= input.west && lon <= input.east;
          });
          counts[layer] = inBounds.length;
          total += inBounds.length;
        }
      }
      return {
        total_entities: total,
        counts_by_layer: counts,
        bounds: { south: input.south, west: input.west, north: input.north, east: input.east },
      };
    });
  }

  // Svelte 5 $effect to synchronize UI store visibility and filters to Cesium layers
  $effect(() => {
    flightLayer?.setVisible(layerStore.visibility.flights);
    marineLayer?.setVisible(layerStore.visibility.marine);
    quakeLayer?.setVisible(layerStore.visibility.quakes);
    firmsLayer?.setVisible(layerStore.visibility.firms);
    gbfsLayer?.setVisible(layerStore.visibility.gbfs);
    cctvLayer?.setVisible(layerStore.visibility.cctv);
    radioLayer?.setVisible(layerStore.visibility.radio);
    launchLayer?.setVisible(layerStore.visibility.launches);
    weatherLayer?.setVisible(layerStore.visibility.weather);

    quakeLayer?.setMinMagnitude(layerStore.filters.quakes.minMagnitude);
    firmsLayer?.setMinFrp(layerStore.filters.firms.minFrp);
    firmsLayer?.setConfidenceFilter(layerStore.filters.firms.confidence);
    marineLayer?.setVesselTypeFilter(layerStore.filters.marine.vesselType);
    gbfsLayer?.setMinBikesAvailable(layerStore.filters.gbfs.minBikes);
    cctvLayer?.setAgencyFilter(layerStore.filters.cctv.agency);
    radioLayer?.setCategoryFilter(layerStore.filters.radio.category);
  });

  // Synchronize remote collaborative presence to Cesium
  $effect(() => {
    collabLayer?.updatePresences(collabStore.state.presences);
    collabLayer?.setFollowLeader(collabStore.state.followLeaderId);
  });

  // Svelte 5 $effect to handle flyTo camera transitions from table or HUD
  $effect(() => {
    const target = layerStore.flyToTarget;
    if (target && globe) {
      globe.setCameraPose({
        longitude: target.lon,
        latitude: target.lat,
        altitude: Math.max(2500, target.alt * 1.5),
        pitch: -55,
      });
      layerStore.clearFlyTo();
    }
  });

  onMount(async () => {
    try {
      globe = new GlobeController({
        container: globeContainer,
        onEntitySelected: handleEntitySelected,
      });

      frameMonitor = new FrameBudgetMonitor({
        targetBudgetMs: 16.666,
        targetFps: 60,
        sampleWindowSize: 120,
      });

      if (globe.viewer.scene) {
        frameMonitor.attachToScene(globe.viewer.scene);
      }

      flightLayer = new FlightLayerController({ viewer: globe.viewer });
      marineLayer = new MarineLayerController({ viewer: globe.viewer });
      quakeLayer = new QuakeLayerController({ viewer: globe.viewer });
      firmsLayer = new FirmsLayerController({ viewer: globe.viewer });
      gbfsLayer = new GbfsLayerController({ viewer: globe.viewer });
      cctvLayer = new CctvLayerController({ viewer: globe.viewer });
      radioLayer = new RadioLayerController({ viewer: globe.viewer });
      launchLayer = new LaunchLayerController({ viewer: globe.viewer });
      weatherLayer = new WeatherLayerController({ viewer: globe.viewer });
      collabLayer = new CollabLayerController({ viewer: globe.viewer });

      setupToolExecutors();

      attachDebugBus(
        globe,
        {
          flight: flightLayer,
          marine: marineLayer,
          quakes: quakeLayer,
          firms: firmsLayer,
          gbfs: gbfsLayer,
          cctv: cctvLayer,
          radio: radioLayer,
          launches: launchLayer,
          weather: weatherLayer,
        },
        {
          frameMonitor,
          attachToWindow:
            import.meta.env.DEV ||
            (typeof window !== 'undefined' &&
              (window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1' ||
                window.location.search.includes('gev_debug=1'))),
        }
      );

      // Deep link inspection
      if (typeof window !== 'undefined' && window.location.href) {
        const sceneFromUrl = parseSceneFromUrl(window.location.href);
        if (sceneFromUrl) {
          globe.setCameraPose(sceneFromUrl.camera);
          layerStore.statusText = 'Loaded scene from deep link';
        }

        const urlParams = new URLSearchParams(window.location.search);
        const roomParam = urlParams.get('room');
        if (roomParam) {
          collabStore.joinRoom(roomParam);
        }
      }

      // Initial poll immediately across all feeds
      await pollAllFeeds();

      // Poll at 5-second human-rate cadence (ADR-0015)
      pollInterval = setInterval(pollAllFeeds, 5000);
    } catch (err: unknown) {
      layerStore.statusText = `Init Error: ${err instanceof Error ? err.message : 'Unknown'}`;
    }
  });

  onDestroy(() => {
    abortController?.abort();
    abortController = null;
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    frameMonitor?.detach();
    flightLayer?.destroy();
    marineLayer?.destroy();
    quakeLayer?.destroy();
    firmsLayer?.destroy();
    gbfsLayer?.destroy();
    cctvLayer?.destroy();
    radioLayer?.destroy();
    launchLayer?.destroy();
    weatherLayer?.destroy();
    collabLayer?.destroy();
    globe?.destroy();
  });
</script>

<main class="app-layout">
  <div bind:this={globeContainer} id="globe-container" class="globe-viewport"></div>

  <!-- HUD Overlays -->
  <HudHeader />
  <div class="collab-overlay">
    <CollabBar />
  </div>
  <LayerControlPanel />
  <EntityInfoCard />
  <VirtualizedTelemetryTable />
  <VoiceControlOrb />

  <!-- OpenStreetMap Mandatory Attribution (Rule 3 & DESIGN.md §5) -->
  <footer id="osm-attribution" class="attribution-badge">
    Map data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors
  </footer>
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background-color: #030712;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    color: #f8fafc;
  }

  .app-layout {
    position: relative;
    width: 100vw;
    height: 100vh;
  }

  .globe-viewport {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }

  .collab-overlay {
    position: absolute;
    top: 64px;
    left: 20px;
    z-index: 10;
  }

  .attribution-badge {
    position: absolute;
    bottom: 8px;
    left: 16px;
    background: rgba(15, 23, 42, 0.8);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(148, 163, 184, 0.15);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 0.68rem;
    color: #94a3b8;
    pointer-events: auto;
    z-index: 10;
  }

  .attribution-badge a {
    color: #38bdf8;
    text-decoration: none;
  }

  .attribution-badge a:hover {
    text-decoration: underline;
  }
</style>
