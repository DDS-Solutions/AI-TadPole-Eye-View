import type {
  CctvLayerController,
  FirmsLayerController,
  FlightLayerController,
  GbfsLayerController,
  LaunchLayerController,
  MarineLayerController,
  QuakeLayerController,
  RadioLayerController,
  WeatherLayerController,
} from '@gev/cesium-kit';
import {
  BikeStationBatch,
  CctvCatalog,
  type DataProvenance,
  EarthquakeCollection,
  FlightBatch,
  LaunchCatalog,
  RadioCatalog,
  ShipBatch,
  ThermalHotspotBatch,
  WeatherCollection,
} from '@gev/contracts';
import { type LayerVisibility, layerStore } from './stores/layers.svelte.js';

interface FeedLayerBindings {
  flights: FlightLayerController | null;
  marine: MarineLayerController | null;
  quakes: QuakeLayerController | null;
  firms: FirmsLayerController | null;
  gbfs: GbfsLayerController | null;
  cctv: CctvLayerController | null;
  radio: RadioLayerController | null;
  launches: LaunchLayerController | null;
  weather: WeatherLayerController | null;
}

interface ProvenanceCarrier {
  provenance: DataProvenance;
}

async function loadFeed<T extends ProvenanceCarrier>(
  layer: keyof LayerVisibility,
  url: string,
  schema: { parse(input: unknown): T },
  signal: AbortSignal,
  consume: (data: T) => void
): Promise<void> {
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}`);
    }
    const data = schema.parse(await response.json());
    consume(data);
    layerStore.setProvenance(layer, data.provenance);
    layerStore.activeErrors[layer] = null;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return;
    }
    layerStore.activeErrors[layer] = error instanceof Error ? error.message : String(error);
  }
}

/** Fetches visible feeds and validates every server response before store or Cesium updates. */
export async function pollVisibleFeeds(
  bindings: FeedLayerBindings,
  signal: AbortSignal
): Promise<void> {
  const tasks: Promise<void>[] = [];

  if (layerStore.visibility.flights && bindings.flights) {
    tasks.push(
      loadFeed('flights', '/api/flights', FlightBatch, signal, (data) => {
        bindings.flights?.enqueueBatch(data);
        layerStore.counts.flights = bindings.flights?.getEntityCount() ?? 0;
        layerStore.rawEntities.flights = data.states;
      })
    );
  }

  if (layerStore.visibility.marine && bindings.marine) {
    tasks.push(
      loadFeed('marine', '/api/ships', ShipBatch, signal, (data) => {
        bindings.marine?.enqueueBatch(data);
        layerStore.counts.marine = bindings.marine?.getEntityCount() ?? 0;
        layerStore.rawEntities.marine = data.ships;
      })
    );
  }

  if (layerStore.visibility.quakes && bindings.quakes) {
    tasks.push(
      loadFeed('quakes', '/api/quakes', EarthquakeCollection, signal, (data) => {
        bindings.quakes?.enqueueCollection(data);
        layerStore.counts.quakes = bindings.quakes?.getEntityCount() ?? 0;
        layerStore.rawEntities.quakes = data.features;
      })
    );
  }

  if (layerStore.visibility.firms && bindings.firms) {
    tasks.push(
      loadFeed('firms', '/api/firms', ThermalHotspotBatch, signal, (data) => {
        bindings.firms?.enqueueBatch(data);
        layerStore.counts.firms = bindings.firms?.getEntityCount() ?? 0;
        layerStore.rawEntities.firms = data.hotspots;
      })
    );
  }

  if (layerStore.visibility.gbfs && bindings.gbfs) {
    tasks.push(
      loadFeed('gbfs', '/api/gbfs', BikeStationBatch, signal, (data) => {
        bindings.gbfs?.enqueueBatch(data);
        layerStore.counts.gbfs = bindings.gbfs?.getEntityCount() ?? 0;
        layerStore.rawEntities.gbfs = data.stations;
      })
    );
  }

  if (layerStore.visibility.cctv && bindings.cctv) {
    tasks.push(
      loadFeed('cctv', '/api/cctv/catalog', CctvCatalog, signal, (data) => {
        bindings.cctv?.enqueueCatalog(data);
        layerStore.counts.cctv = bindings.cctv?.getEntityCount() ?? 0;
        layerStore.rawEntities.cctv = data.cameras;
      })
    );
  }

  if (layerStore.visibility.radio && bindings.radio) {
    tasks.push(
      loadFeed('radio', '/api/radio/catalog', RadioCatalog, signal, (data) => {
        bindings.radio?.enqueueCatalog(data);
        layerStore.counts.radio = bindings.radio?.getEntityCount() ?? 0;
        layerStore.rawEntities.radio = data.stations;
      })
    );
  }

  if (layerStore.visibility.launches && bindings.launches) {
    tasks.push(
      loadFeed('launches', '/api/launches', LaunchCatalog, signal, (data) => {
        bindings.launches?.enqueueCatalog(data);
        layerStore.counts.launches = bindings.launches?.getEntityCount() ?? 0;
        layerStore.rawEntities.launches = data.missions;
      })
    );
  }

  if (layerStore.visibility.weather && bindings.weather) {
    tasks.push(
      loadFeed('weather', '/api/weather/radar', WeatherCollection, signal, (data) => {
        bindings.weather?.enqueueCollection(data);
        layerStore.counts.weather = bindings.weather?.getEntityCount() ?? 0;
        layerStore.rawEntities.weather = data.stations;
      })
    );
  }

  await Promise.all(tasks);
}
