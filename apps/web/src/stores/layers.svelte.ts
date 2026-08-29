import type {
  BikeStation,
  CctvCamera,
  DataProvenance,
  EarthquakeFeature,
  FlightState,
  LaunchMission,
  RadioStation,
  ShipState,
  ThermalHotspot,
  WeatherStation,
} from '@gev/contracts';

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
  kind: 'flight' | 'marine' | 'quake' | 'firms' | 'gbfs' | 'cctv' | 'radio' | 'launch' | 'weather';
  id: string;
  name: string;
  data: Record<string, unknown>;
}

export interface UnifiedTelemetryItem {
  id: string;
  kind: 'flight' | 'marine' | 'quake' | 'firms' | 'gbfs' | 'cctv' | 'radio' | 'launch' | 'weather';
  name: string;
  metric1: string;
  metric2: string;
  coordinates: string;
  lat: number;
  lon: number;
  alt: number;
  timeText: string;
  rawData: Record<string, unknown>;
}

class LayerStore {
  // Layer visibility flags for all 9 layers
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

  // Active entity counts across all 9 feeds
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
  rawEntities = $state<{
    flights: FlightState[];
    marine: ShipState[];
    quakes: EarthquakeFeature[];
    firms: ThermalHotspot[];
    gbfs: BikeStation[];
    cctv: CctvCamera[];
    radio: RadioStation[];
    launches: LaunchMission[];
    weather: WeatherStation[];
  }>({
    flights: [],
    marine: [],
    quakes: [],
    firms: [],
    gbfs: [],
    cctv: [],
    radio: [],
    launches: [],
    weather: [],
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
      (this.visibility.weather ? this.counts.weather : 0)
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
  });

  // Active inspection selection
  selectedEntity = $state<EntitySelection | null>(null);

  // Fly-to target requested from UI (lat, lon, alt)
  flyToTarget = $state<{ lat: number; lon: number; alt: number } | null>(null);

  // Derived unified telemetry feed for virtualized table
  unifiedItems = $derived.by(() => {
    const items: UnifiedTelemetryItem[] = [];

    // 1. Flights
    if (this.visibility.flights) {
      for (const f of this.rawEntities.flights) {
        if (f.longitude === null || f.latitude === null) continue;
        const alt = f.geo_altitude ?? f.baro_altitude ?? 0;
        items.push({
          id: f.icao24,
          kind: 'flight',
          name: f.callsign || f.icao24,
          metric1: `Alt: ${alt.toLocaleString()}m`,
          metric2: `Vel: ${f.velocity ? `${f.velocity.toFixed(0)} m/s` : 'N/A'}`,
          coordinates: `${f.latitude.toFixed(2)}°, ${f.longitude.toFixed(2)}°`,
          lat: f.latitude,
          lon: f.longitude,
          alt: Math.max(1000, alt),
          timeText: f.last_contact ? new Date(f.last_contact * 1000).toLocaleTimeString() : 'Live',
          rawData: f as unknown as Record<string, unknown>,
        });
      }
    }

    // 2. Ships
    if (this.visibility.marine) {
      for (const s of this.rawEntities.marine) {
        items.push({
          id: s.mmsi,
          kind: 'marine',
          name: s.name || `Vessel ${s.mmsi}`,
          metric1: `SOG: ${(s.sog_knots ?? 0).toFixed(1)} kts`,
          metric2: `Type: ${s.ship_type ?? 'Cargo'}`,
          coordinates: `${s.latitude.toFixed(2)}°, ${s.longitude.toFixed(2)}°`,
          lat: s.latitude,
          lon: s.longitude,
          alt: 500,
          timeText: 'Live AIS',
          rawData: s as unknown as Record<string, unknown>,
        });
      }
    }

    // 3. Quakes
    if (this.visibility.quakes) {
      for (const q of this.rawEntities.quakes) {
        items.push({
          id: q.id,
          kind: 'quake',
          name: `M${q.mag.toFixed(1)} Earthquake`,
          metric1: `Mag: M${q.mag.toFixed(1)}`,
          metric2: `Depth: ${q.depth_km} km`,
          coordinates: `${q.latitude.toFixed(2)}°, ${q.longitude.toFixed(2)}°`,
          lat: q.latitude,
          lon: q.longitude,
          alt: 5000,
          timeText: q.time ? new Date(q.time).toLocaleTimeString() : 'Recent',
          rawData: q as unknown as Record<string, unknown>,
        });
      }
    }

    // 4. FIRMS
    if (this.visibility.firms) {
      for (const h of this.rawEntities.firms) {
        items.push({
          id: h.id,
          kind: 'firms',
          name: `Thermal Hotspot ${h.id}`,
          metric1: `FRP: ${h.frp_mw.toFixed(1)} MW`,
          metric2: `Temp: ${h.brightness_kelvin.toFixed(0)} K`,
          coordinates: `${h.latitude.toFixed(2)}°, ${h.longitude.toFixed(2)}°`,
          lat: h.latitude,
          lon: h.longitude,
          alt: 2000,
          timeText: `${h.acq_date} ${h.acq_time}`,
          rawData: h as unknown as Record<string, unknown>,
        });
      }
    }

    // 5. GBFS
    if (this.visibility.gbfs) {
      for (const b of this.rawEntities.gbfs) {
        items.push({
          id: b.station_id,
          kind: 'gbfs',
          name: b.name,
          metric1: `Bikes: ${b.num_bikes_available}`,
          metric2: `Docks: ${b.num_docks_available}`,
          coordinates: `${b.latitude.toFixed(2)}°, ${b.longitude.toFixed(2)}°`,
          lat: b.latitude,
          lon: b.longitude,
          alt: 500,
          timeText: 'Realtime',
          rawData: b as unknown as Record<string, unknown>,
        });
      }
    }

    // 6. CCTV
    if (this.visibility.cctv) {
      for (const c of this.rawEntities.cctv) {
        items.push({
          id: c.id,
          kind: 'cctv',
          name: c.name,
          metric1: `Agency: ${c.agency}`,
          metric2: `Rate: ${c.refresh_interval_sec}s`,
          coordinates: `${c.latitude.toFixed(2)}°, ${c.longitude.toFixed(2)}°`,
          lat: c.latitude,
          lon: c.longitude,
          alt: 400,
          timeText: c.status,
          rawData: c as unknown as Record<string, unknown>,
        });
      }
    }

    // 7. Radio
    if (this.visibility.radio) {
      for (const r of this.rawEntities.radio) {
        items.push({
          id: r.id,
          kind: 'radio',
          name: r.name,
          metric1: `Freq: ${r.frequency_mhz ? `${r.frequency_mhz} MHz` : 'Web'}`,
          metric2: `Cat: ${r.category.toUpperCase()}`,
          coordinates: `${r.latitude.toFixed(2)}°, ${r.longitude.toFixed(2)}°`,
          lat: r.latitude,
          lon: r.longitude,
          alt: 400,
          timeText: `${r.bitrate_kbps} kbps`,
          rawData: r as unknown as Record<string, unknown>,
        });
      }
    }

    // 8. Launches
    if (this.visibility.launches) {
      for (const l of this.rawEntities.launches) {
        const firstPt = l.trajectory[0];
        const lat = firstPt?.latitude ?? 34.6;
        const lon = firstPt?.longitude ?? -120.6;
        items.push({
          id: l.id,
          kind: 'launch',
          name: l.name,
          metric1: `Orbit: ${l.target_orbit}`,
          metric2: `Vehicle: ${l.vehicle}`,
          coordinates: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`,
          lat,
          lon,
          alt: 50000,
          timeText: l.status.toUpperCase(),
          rawData: l as unknown as Record<string, unknown>,
        });
      }
    }

    // 9. Weather
    if (this.visibility.weather) {
      for (const w of this.rawEntities.weather) {
        items.push({
          id: w.id,
          kind: 'weather',
          name: w.name,
          metric1: `Temp: ${w.temp_c}°C`,
          metric2: `Wind: ${w.wind_speed_kmh} km/h`,
          coordinates: `${w.latitude.toFixed(2)}°, ${w.longitude.toFixed(2)}°`,
          lat: w.latitude,
          lon: w.longitude,
          alt: 600,
          timeText: w.condition,
          rawData: w as unknown as Record<string, unknown>,
        });
      }
    }

    return items;
  });

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
    this.visibility[layer] = !this.visibility[layer];
  }

  setProvenance(layer: keyof LayerVisibility, provenance: DataProvenance): void {
    this.provenance[layer] = provenance;
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
