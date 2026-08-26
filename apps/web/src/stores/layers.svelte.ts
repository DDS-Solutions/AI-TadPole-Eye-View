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

  toggleLayer(layer: keyof LayerVisibility): void {
    this.visibility[layer] = !this.visibility[layer];
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
}

export const layerStore = new LayerStore();
