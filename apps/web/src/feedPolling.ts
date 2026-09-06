import type {
  AviationWeatherLayerController,
  CableLayerController,
  CctvLayerController,
  FirmsLayerController,
  FlightLayerController,
  GbfsLayerController,
  LaunchLayerController,
  MarineLayerController,
  NwsAlertLayerController,
  QuakeLayerController,
  RadioLayerController,
  SatelliteLayerController,
  SolarContextLayerController,
  WeatherLayerController,
} from '@gev/cesium-kit';
import {
  AviationWeatherResponseSchema,
  BikeStationBatch,
  CableCatalogResponseSchema,
  CctvCatalog,
  type DataProvenance,
  EarthquakeCollection,
  FlightBatch,
  LaunchCatalog,
  NwsAlertCollectionSchema,
  RadioCatalog,
  SatellitePropagationBatchSchema,
  ShipBatch,
  SolarContextResponseSchema,
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
  cables: CableLayerController | null;
  satellites: SatelliteLayerController | null;
  solar: SolarContextLayerController | null;
  alerts: NwsAlertLayerController | null;
  aviationWeather: AviationWeatherLayerController | null;
}

interface ProvenanceCarrier {
  provenance: DataProvenance;
}

class FeedHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string
  ) {
    super(message);
    this.name = 'FeedHttpError';
  }
}

async function createFeedHttpError(response: Response, url: string): Promise<FeedHttpError> {
  let code: string | null = null;
  let message = `${url} returned HTTP ${response.status}`;
  try {
    const payload: unknown = await response.json();
    if (typeof payload === 'object' && payload !== null) {
      const record = payload as Record<string, unknown>;
      if (typeof record.code === 'string') code = record.code;
      if (typeof record.error === 'string') message = record.error;
    }
  } catch {
    // A non-JSON error remains a bounded status-only failure.
  }
  return new FeedHttpError(response.status, code, message);
}

async function loadFeed<T extends ProvenanceCarrier>(
  layer: keyof LayerVisibility,
  url: string,
  schema: { parse(input: unknown): T },
  signal: AbortSignal,
  consume: (data: T) => void,
  clear?: () => void
): Promise<void> {
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw await createFeedHttpError(response, url);
    }
    const data = schema.parse(await response.json());
    consume(data);
    layerStore.setProvenance(layer, data.provenance);
    layerStore.activeErrors[layer] = null;
    if (layer === 'satellites') layerStore.setSatelliteAccessLock(null);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return;
    }
    layerStore.activeErrors[layer] = error instanceof Error ? error.message : String(error);
    clear?.();
    if (
      layer === 'satellites' &&
      error instanceof FeedHttpError &&
      (error.code === 'TERMS_APPROVAL_REQUIRED' || error.code === 'PROVIDER_DISABLED')
    ) {
      layerStore.setSatelliteAccessLock(error.message, error.code);
    }
  }
}

/** Fetches visible feeds and validates every server response before store or Cesium updates. */
export async function pollVisibleFeeds(
  bindings: FeedLayerBindings,
  signal: AbortSignal
): Promise<void> {
  const tasks: Promise<void>[] = [];
  const aoi = layerStore.operationalAoi;
  const aoiQuery = new URLSearchParams({
    min_lat: String(aoi.min_lat),
    max_lat: String(aoi.max_lat),
    min_lon: String(aoi.min_lon),
    max_lon: String(aoi.max_lon),
  }).toString();

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

  if (layerStore.visibility.cables && bindings.cables) {
    tasks.push(
      loadFeed('cables', '/api/cables', CableCatalogResponseSchema, signal, (data) => {
        bindings.cables?.enqueueCatalog(data);
        layerStore.counts.cables = bindings.cables?.getEntityCount() ?? 0;
        layerStore.rawEntities.cables = data.routes;
      })
    );
  }

  if (
    (layerStore.visibility.satellites || layerStore.satelliteAccessLock !== null) &&
    bindings.satellites
  ) {
    tasks.push(
      loadFeed('satellites', '/api/satellites', SatellitePropagationBatchSchema, signal, (data) => {
        bindings.satellites?.enqueueBatch(data);
        layerStore.counts.satellites = bindings.satellites?.getEntityCount() ?? 0;
        layerStore.satelliteOmittedCount = data.omitted_count;
        layerStore.rawEntities.satellites = data.states;
        layerStore.refreshSelectedSatellite(data.states);
      })
    );
  }

  if (layerStore.visibility.solar && bindings.solar) {
    tasks.push(
      loadFeed('solar', '/api/operational/solar', SolarContextResponseSchema, signal, (data) => {
        bindings.solar?.enqueueContext(data);
        layerStore.counts.solar = bindings.solar?.getEntityCount() ?? 0;
        layerStore.operationalEntities.solar = data;
      })
    );
  }

  if (layerStore.visibility.alerts && bindings.alerts) {
    tasks.push(
      loadFeed(
        'alerts',
        `/api/operational/alerts?${aoiQuery}`,
        NwsAlertCollectionSchema,
        signal,
        (data) => {
          bindings.alerts?.enqueueCollection(data);
          layerStore.counts.alerts = data.alerts.length;
          layerStore.operationalEntities.alerts = data.alerts;
        },
        () => {
          bindings.alerts?.clear();
          layerStore.counts.alerts = 0;
          layerStore.operationalEntities.alerts = [];
        }
      )
    );
  }

  if (layerStore.visibility.aviationWeather && bindings.aviationWeather) {
    tasks.push(
      loadFeed(
        'aviationWeather',
        `/api/operational/aviation?${aoiQuery}`,
        AviationWeatherResponseSchema,
        signal,
        (data) => {
          bindings.aviationWeather?.enqueueWeather(data);
          const items = [
            ...data.metars.items.map((item) => ({ ...item, product: 'metar' as const })),
            ...data.tafs.items.map((item) => ({ ...item, product: 'taf' as const })),
            ...data.sigmets.items.map((item) => ({ ...item, product: 'sigmet' as const })),
          ];
          layerStore.counts.aviationWeather = items.length;
          layerStore.operationalEntities.aviationWeather = items;
        },
        () => {
          bindings.aviationWeather?.clear();
          layerStore.counts.aviationWeather = 0;
          layerStore.operationalEntities.aviationWeather = [];
        }
      )
    );
  }

  await Promise.all(tasks);
}
