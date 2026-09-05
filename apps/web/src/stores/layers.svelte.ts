import {
  type CableRoute,
  type DataProvenance,
  SATELLITE_USAGE_NOTICE,
  type SatellitePropagatedState,
} from '@gev/contracts';
import { type UnifiedEntityCollections, buildUnifiedTelemetryItems } from '../unifiedTelemetry.js';

export type { UnifiedTelemetryItem } from '../unifiedTelemetry.js';

export interface LayerVisibility {
  flights: boolean;
  marine: boolean;
  quakes: boolean;
  firms: boolean;
  gbfs: boolean;
  cctv: boolean;
  radio: boolean;
  launches: boolean;
  weather: boolean;
  cables: boolean;
  satellites: boolean;
}

export interface ProvenanceSummary {
  sourceCount: number;
  sourceLabel: string;
  modeLabel: string;
  freshnessLabel: string;
  details: string;
}

export interface LayerFilters {
  quakes: { minMagnitude: number };
  firms: { minFrp: number; confidence: string };
  gbfs: { minBikes: number };
  marine: { vesselType: string };
  cctv: { agency: string };
  radio: { category: string };
}

export interface EntitySelection {
  kind:
    | 'flight'
    | 'marine'
    | 'quake'
    | 'firms'
    | 'gbfs'
    | 'cctv'
    | 'radio'
    | 'launch'
    | 'weather'
    | 'cable'
    | 'satellite';
  id: string;
  name: string;
  data: Record<string, unknown>;
}

class LayerStore {
  // Layer visibility flags for implemented globe layers.
  visibility = $state<LayerVisibility>({
    flights: true,
    marine: true,
    quakes: true,
    firms: true,
    gbfs: true,
    cctv: true,
    radio: true,
    launches: true,
    weather: true,
    cables: true,
    satellites: true,
  });

  // Layer filter settings
  filters = $state<LayerFilters>({
    quakes: { minMagnitude: 0 },
    firms: { minFrp: 0, confidence: 'all' },
    gbfs: { minBikes: 0 },
    marine: { vesselType: 'all' },
    cctv: { agency: 'all' },
    radio: { category: 'all' },
  });

  // Active entity counts across implemented globe layers.
  counts = $state({
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

  // Last validated provenance envelope for each visible telemetry layer.
  provenance = $state<Partial<Record<keyof LayerVisibility, DataProvenance>>>({});

  provenanceSummary = $derived.by((): ProvenanceSummary => {
    const layerKeys = Object.keys(this.visibility) as Array<keyof LayerVisibility>;
    const visible = layerKeys
      .filter((key) => this.visibility[key])
      .map((key) => this.provenance[key])
      .filter((value): value is DataProvenance => value !== undefined);
    const sourceIds = new Set(visible.map((value) => value.source.provider_id));
    const modes = [...new Set(visible.map((value) => value.mode))].sort();
    const freshnessStates = new Set(visible.map((value) => value.freshness.status));
    const freshnessLabel = freshnessStates.has('stale')
      ? 'STALE'
      : freshnessStates.has('unavailable')
        ? 'PARTIAL'
        : freshnessStates.has('fresh')
          ? 'FRESH'
          : 'AWAITING';
    const sourceLabel = `${sourceIds.size} ${sourceIds.size === 1 ? 'SOURCE' : 'SOURCES'}`;
    const modeLabel = modes.length === 0 ? 'AWAITING' : modes.join(' + ').toUpperCase();
    const details = visible
      .map(
        (value) =>
          `${value.source.name}: ${value.mode}, ${value.freshness.status}, retrieved ${value.retrieved_at}`
      )
      .join('\n');

    return { sourceCount: sourceIds.size, sourceLabel, modeLabel, freshnessLabel, details };
  });

  // Raw entities cached for High-Density Telemetry Table
  rawEntities = $state<UnifiedEntityCollections & { cables: CableRoute[] }>({
    flights: [],
    marine: [],
    quakes: [],
    firms: [],
    gbfs: [],
    cctv: [],
    radio: [],
    launches: [],
    weather: [],
    cables: [],
    satellites: [],
  });

  // High-Density Telemetry Table UI state
  isTableOpen = $state(false);
  tableQuery = $state('');
  tableChannel = $state<
    | 'all'
    | 'flight'
    | 'marine'
    | 'quake'
    | 'firms'
    | 'gbfs'
    | 'cctv'
    | 'radio'
    | 'launch'
    | 'weather'
    | 'satellite'
  >('all');

  // Total active entities across visible layers
  totalCount = $derived(
    (this.visibility.flights ? this.counts.flights : 0) +
      (this.visibility.marine ? this.counts.marine : 0) +
      (this.visibility.quakes ? this.counts.quakes : 0) +
      (this.visibility.firms ? this.counts.firms : 0) +
      (this.visibility.gbfs ? this.counts.gbfs : 0) +
      (this.visibility.cctv ? this.counts.cctv : 0) +
      (this.visibility.radio ? this.counts.radio : 0) +
      (this.visibility.launches ? this.counts.launches : 0) +
      (this.visibility.weather ? this.counts.weather : 0) +
      (this.visibility.cables ? this.counts.cables : 0) +
      (this.visibility.satellites ? this.counts.satellites : 0)
  );

  // Global console status
  statusText = $state('Initializing Tactical Console...');
  lastSyncTime = $state('');
  activeErrors = $state<Record<string, string | null>>({
    flights: null,
    marine: null,
    quakes: null,
    firms: null,
    gbfs: null,
    cctv: null,
    radio: null,
    launches: null,
    weather: null,
    cables: null,
    satellites: null,
  });
  satelliteAccessLock = $state<string | null>(null);
  satelliteAccessLockCode = $state<string | null>(null);
  satelliteOmittedCount = $state(0);

  // Active inspection selection
  selectedEntity = $state<EntitySelection | null>(null);

  // Fly-to target requested from UI (lat, lon, alt)
  flyToTarget = $state<{ lat: number; lon: number; alt: number } | null>(null);

  // Derived unified telemetry feed for virtualized table
  unifiedItems = $derived.by(() => buildUnifiedTelemetryItems(this.visibility, this.rawEntities));

  // Filtered telemetry feed matching search query and channel filter
  filteredItems = $derived.by(() => {
    const q = this.tableQuery.toLowerCase().trim();
    const ch = this.tableChannel;

    return this.unifiedItems.filter((item) => {
      if (ch !== 'all' && item.kind !== ch) {
        return false;
      }
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        item.metric1.toLowerCase().includes(q) ||
        item.metric2.toLowerCase().includes(q) ||
        item.coordinates.toLowerCase().includes(q)
      );
    });
  });

  toggleLayer(layer: keyof LayerVisibility): void {
    if (layer === 'satellites' && this.satelliteAccessLock) {
      return;
    }
    this.visibility[layer] = !this.visibility[layer];
  }

  setSatelliteAccessLock(reason: string | null, code: string | null = null): void {
    this.satelliteAccessLock = reason;
    this.satelliteAccessLockCode = code;
    if (reason) {
      this.visibility.satellites = false;
      this.counts.satellites = 0;
      this.satelliteOmittedCount = 0;
      this.rawEntities.satellites = [];
    }
  }

  setProvenance(layer: keyof LayerVisibility, provenance: DataProvenance): void {
    this.provenance[layer] = provenance;
  }

  refreshSelectedSatellite(states: readonly SatellitePropagatedState[]): void {
    const selected = this.selectedEntity;
    if (!selected || selected.kind !== 'satellite') return;
    const selectedCatalogId = String(
      selected.data.catalogId ?? selected.data.catalog_id ?? selected.id.replace(/^satellite-/, '')
    );
    const state = states.find((candidate) => candidate.catalog_id === selectedCatalogId);
    if (!state) return;

    this.selectedEntity = {
      ...selected,
      name: state.object_name,
      data: {
        ...selected.data,
        entityKind: 'satellite',
        catalogId: state.catalog_id,
        objectId: state.object_id,
        sourceGroup: state.source_group,
        elementEpoch: state.element_epoch,
        propagatedAt: state.propagated_at,
        propagationMethod: state.propagation_method,
        isEstimate: state.is_estimate,
        usageNotice: SATELLITE_USAGE_NOTICE,
        longitude: state.longitude_deg,
        latitude: state.latitude_deg,
        altitudeM: state.altitude_m,
        speedMps: state.speed_mps,
      },
    };
  }

  setQuakeMinMagnitude(minMag: number): void {
    this.filters.quakes.minMagnitude = minMag;
  }

  setFirmsMinFrp(minFrp: number): void {
    this.filters.firms.minFrp = minFrp;
  }

  setFirmsConfidence(conf: string): void {
    this.filters.firms.confidence = conf;
  }

  setGbfsMinBikes(minBikes: number): void {
    this.filters.gbfs.minBikes = minBikes;
  }

  setMarineVesselType(type: string): void {
    this.filters.marine.vesselType = type;
  }

  setCctvAgency(agency: string): void {
    this.filters.cctv.agency = agency;
  }

  setRadioCategory(category: string): void {
    this.filters.radio.category = category;
  }

  selectEntity(selection: EntitySelection | null): void {
    this.selectedEntity = selection;
  }

  clearSelection(): void {
    this.selectedEntity = null;
  }

  triggerFlyTo(lat: number, lon: number, alt: number): void {
    this.flyToTarget = { lat, lon, alt };
  }

  clearFlyTo(): void {
    this.flyToTarget = null;
  }

  toggleTable(open?: boolean): void {
    this.isTableOpen = open ?? !this.isTableOpen;
  }
}

export const layerStore = new LayerStore();
