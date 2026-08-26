<script lang="ts">
  import { layerStore } from '../stores/layers.svelte.js';

  let isCollapsed = $state(false);
  let activeTab = $state<'layers' | 'filters'>('layers');
</script>

<aside class="layer-control-panel" class:collapsed={isCollapsed}>
  <div class="panel-header">
    <div class="header-left">
      <span class="panel-icon">⚡</span>
      <h2 class="panel-title">Tactical Feeds & Filters</h2>
    </div>
    <div class="header-actions">
      <button
        class="tab-btn"
        class:active={activeTab === 'layers'}
        onclick={() => (activeTab = 'layers')}
      >
        Layers
      </button>
      <button
        class="tab-btn"
        class:active={activeTab === 'filters'}
        onclick={() => (activeTab = 'filters')}
      >
        Filters
      </button>
      <button
        id="toggle-collapse-btn"
        class="collapse-btn"
        onclick={() => (isCollapsed = !isCollapsed)}
        title={isCollapsed ? 'Expand Panel' : 'Collapse Panel'}
      >
        {isCollapsed ? '◀' : '▼'}
      </button>
    </div>
  </div>

  {#if !isCollapsed}
    <div class="panel-content">
      {#if activeTab === 'layers'}
        <div class="layer-toggles-grid">
          <!-- Aviation ADS-B -->
          <div class="layer-toggle-row flight-row">
            <div class="layer-info">
              <span class="layer-indicator flight-ind"></span>
              <div class="layer-text">
                <span class="layer-name">ADS-B Aviation</span>
                <span class="layer-sub">OpenSky Network</span>
              </div>
            </div>
            <label class="switch">
              <input
                id="toggle-flights"
                type="checkbox"
                checked={layerStore.visibility.flights}
                onchange={() => layerStore.toggleLayer('flights')}
              />
              <span class="slider flight-slider"></span>
            </label>
          </div>

          <!-- Marine AIS -->
          <div class="layer-toggle-row marine-row">
            <div class="layer-info">
              <span class="layer-indicator marine-ind"></span>
              <div class="layer-text">
                <span class="layer-name">AIS Maritime</span>
                <span class="layer-sub">AISStream Telemetry</span>
              </div>
            </div>
            <label class="switch">
              <input
                id="toggle-marine"
                type="checkbox"
                checked={layerStore.visibility.marine}
                onchange={() => layerStore.toggleLayer('marine')}
              />
              <span class="slider marine-slider"></span>
            </label>
          </div>

          <!-- USGS Earthquakes -->
          <div class="layer-toggle-row quake-row">
            <div class="layer-info">
              <span class="layer-indicator quake-ind"></span>
              <div class="layer-text">
                <span class="layer-name">USGS Earthquakes</span>
                <span class="layer-sub">Global Seismic Network</span>
              </div>
            </div>
            <label class="switch">
              <input
                id="toggle-quakes"
                type="checkbox"
                checked={layerStore.visibility.quakes}
                onchange={() => layerStore.toggleLayer('quakes')}
              />
              <span class="slider quake-slider"></span>
            </label>
          </div>

          <!-- NASA FIRMS Thermal -->
          <div class="layer-toggle-row firms-row">
            <div class="layer-info">
              <span class="layer-indicator firms-ind"></span>
              <div class="layer-text">
                <span class="layer-name">NASA FIRMS Fires</span>
                <span class="layer-sub">MODIS & VIIRS Hotspots</span>
              </div>
            </div>
            <label class="switch">
              <input
                id="toggle-firms"
                type="checkbox"
                checked={layerStore.visibility.firms}
                onchange={() => layerStore.toggleLayer('firms')}
              />
              <span class="slider firms-slider"></span>
            </label>
          </div>

          <!-- GBFS Bikeshare -->
          <div class="layer-toggle-row gbfs-row">
            <div class="layer-info">
              <span class="layer-indicator gbfs-ind"></span>
              <div class="layer-text">
                <span class="layer-name">GBFS Bikeshare</span>
                <span class="layer-sub">Urban Micromobility</span>
              </div>
            </div>
            <label class="switch">
              <input
                id="toggle-gbfs"
                type="checkbox"
                checked={layerStore.visibility.gbfs}
                onchange={() => layerStore.toggleLayer('gbfs')}
              />
              <span class="slider gbfs-slider"></span>
            </label>
          </div>

          <!-- Public CCTV Cameras -->
          <div class="layer-toggle-row cctv-row">
            <div class="layer-info">
              <span class="layer-indicator cctv-ind"></span>
              <div class="layer-text">
                <span class="layer-name">Public CCTV</span>
                <span class="layer-sub">DOT Traffic & Weather</span>
              </div>
            </div>
            <label class="switch">
              <input
                id="toggle-cctv"
                type="checkbox"
                checked={layerStore.visibility.cctv}
                onchange={() => layerStore.toggleLayer('cctv')}
              />
              <span class="slider cctv-slider"></span>
            </label>
          </div>

          <!-- Radio & ATC -->
          <div class="layer-toggle-row radio-row">
            <div class="layer-info">
              <span class="layer-indicator radio-ind"></span>
              <div class="layer-text">
                <span class="layer-name">Radio & ATC Freqs</span>
                <span class="layer-sub">Live Audio Streams</span>
              </div>
            </div>
            <label class="switch">
              <input
                id="toggle-radio"
                type="checkbox"
                checked={layerStore.visibility.radio}
                onchange={() => layerStore.toggleLayer('radio')}
              />
              <span class="slider radio-slider"></span>
            </label>
          </div>

          <!-- Space Launch Replays -->
          <div class="layer-toggle-row launch-row">
            <div class="layer-info">
              <span class="layer-indicator launch-ind"></span>
              <div class="layer-text">
                <span class="layer-name">Launch Trajectories</span>
                <span class="layer-sub">Orbital Ascent Replays</span>
              </div>
            </div>
            <label class="switch">
              <input
                id="toggle-launches"
                type="checkbox"
                checked={layerStore.visibility.launches}
                onchange={() => layerStore.toggleLayer('launches')}
              />
              <span class="slider launch-slider"></span>
            </label>
          </div>

          <!-- Weather Radar -->
          <div class="layer-toggle-row weather-row">
            <div class="layer-info">
              <span class="layer-indicator weather-ind"></span>
              <div class="layer-text">
                <span class="layer-name">Weather & Radar</span>
                <span class="layer-sub">RainViewer Precipitation</span>
              </div>
            </div>
            <label class="switch">
              <input
                id="toggle-weather"
                type="checkbox"
                checked={layerStore.visibility.weather}
                onchange={() => layerStore.toggleLayer('weather')}
              />
              <span class="slider weather-slider"></span>
            </label>
          </div>
        </div>
      {:else}
        <!-- Filter Controls -->
        <div class="filters-container">
          <!-- Quakes Filter -->
          <div class="filter-group">
            <div class="filter-group-header">
              <span class="channel-dot quake-dot"></span>
              <span class="filter-title">USGS Earthquake Magnitude</span>
            </div>
            <div class="filter-options-row">
              <button
                class="filter-chip"
                class:active={layerStore.filters.quakes.minMagnitude === 0}
                onclick={() => layerStore.setQuakeMinMagnitude(0)}
              >
                All (M0+)
              </button>
              <button
                id="filter-quakes-m25"
                class="filter-chip"
                class:active={layerStore.filters.quakes.minMagnitude === 2.5}
                onclick={() => layerStore.setQuakeMinMagnitude(2.5)}
              >
                M2.5+
              </button>
              <button
                id="filter-quakes-m45"
                class="filter-chip"
                class:active={layerStore.filters.quakes.minMagnitude === 4.5}
                onclick={() => layerStore.setQuakeMinMagnitude(4.5)}
              >
                M4.5+ (Major)
              </button>
            </div>
          </div>

          <!-- FIRMS Filter -->
          <div class="filter-group">
            <div class="filter-group-header">
              <span class="channel-dot firms-dot"></span>
              <span class="filter-title">NASA FIRMS Fire Power (FRP)</span>
            </div>
            <div class="filter-options-row">
              <button
                class="filter-chip"
                class:active={layerStore.filters.firms.minFrp === 0}
                onclick={() => layerStore.setFirmsMinFrp(0)}
              >
                All
              </button>
              <button
                id="filter-firms-frp10"
                class="filter-chip"
                class:active={layerStore.filters.firms.minFrp === 10}
                onclick={() => layerStore.setFirmsMinFrp(10)}
              >
                &gt;10 MW
              </button>
              <button
                id="filter-firms-frp50"
                class="filter-chip"
                class:active={layerStore.filters.firms.minFrp === 50}
                onclick={() => layerStore.setFirmsMinFrp(50)}
              >
                &gt;50 MW (Severe)
              </button>
            </div>
          </div>

          <!-- Marine AIS Filter -->
          <div class="filter-group">
            <div class="filter-group-header">
              <span class="channel-dot marine-dot"></span>
              <span class="filter-title">Marine Vessel Category</span>
            </div>
            <div class="filter-options-row">
              <button
                class="filter-chip"
                class:active={layerStore.filters.marine.vesselType === 'all'}
                onclick={() => layerStore.setMarineVesselType('all')}
              >
                All
              </button>
              <button
                id="filter-marine-cargo"
                class="filter-chip"
                class:active={layerStore.filters.marine.vesselType === 'cargo'}
                onclick={() => layerStore.setMarineVesselType('cargo')}
              >
                Cargo
              </button>
              <button
                id="filter-marine-tanker"
                class="filter-chip"
                class:active={layerStore.filters.marine.vesselType === 'tanker'}
                onclick={() => layerStore.setMarineVesselType('tanker')}
              >
                Tanker
              </button>
            </div>
          </div>

          <!-- CCTV Agency Filter -->
          <div class="filter-group">
            <div class="filter-group-header">
              <span class="channel-dot cctv-dot"></span>
              <span class="filter-title">CCTV Managing Agency</span>
            </div>
            <div class="filter-options-row">
              <button
                class="filter-chip"
                class:active={layerStore.filters.cctv.agency === 'all'}
                onclick={() => layerStore.setCctvAgency('all')}
              >
                All Agencies
              </button>
              <button
                id="filter-cctv-caltrans"
                class="filter-chip"
                class:active={layerStore.filters.cctv.agency === 'caltrans'}
                onclick={() => layerStore.setCctvAgency('caltrans')}
              >
                Caltrans
              </button>
              <button
                id="filter-cctv-nycdot"
                class="filter-chip"
                class:active={layerStore.filters.cctv.agency === 'nycdot'}
                onclick={() => layerStore.setCctvAgency('nycdot')}
              >
                NYCDOT
              </button>
            </div>
          </div>

          <!-- Radio Category Filter -->
          <div class="filter-group">
            <div class="filter-group-header">
              <span class="channel-dot radio-dot"></span>
              <span class="filter-title">Radio Stream Genre</span>
            </div>
            <div class="filter-options-row">
              <button
                class="filter-chip"
                class:active={layerStore.filters.radio.category === 'all'}
                onclick={() => layerStore.setRadioCategory('all')}
              >
                All
              </button>
              <button
                id="filter-radio-atc"
                class="filter-chip"
                class:active={layerStore.filters.radio.category === 'atc'}
                onclick={() => layerStore.setRadioCategory('atc')}
              >
                ATC Tower
              </button>
              <button
                id="filter-radio-marine"
                class="filter-chip"
                class:active={layerStore.filters.radio.category === 'marine'}
                onclick={() => layerStore.setRadioCategory('marine')}
              >
                Marine VHF
              </button>
            </div>
          </div>
        </div>
      {/if}

      <!-- Footer Policy / Mode Badge -->
      <div class="panel-footer-meta">
        <span class="meta-tag">SEED MODE ACTIVE</span>
        <span class="meta-desc">Zero Live Quota Burn</span>
      </div>
    </div>
  {/if}
</aside>

<style>
  .layer-control-panel {
    position: absolute;
    top: 85px;
    left: 16px;
    width: 320px;
    max-height: calc(100vh - 120px);
    overflow-y: auto;
    background: rgba(15, 23, 42, 0.88);
    backdrop-filter: blur(14px);
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 10px;
    padding: 14px;
    pointer-events: auto;
    z-index: 20;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
    transition: width 0.2s ease, padding 0.2s ease;
  }

  .layer-control-panel.collapsed {
    width: auto;
    padding: 8px 12px;
    max-height: none;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.12);
    padding-bottom: 8px;
  }

  .layer-control-panel.collapsed .panel-header {
    margin-bottom: 0;
    border-bottom: none;
    padding-bottom: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .panel-icon {
    font-size: 0.85rem;
  }

  .panel-title {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: #f8fafc;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .tab-btn {
    background: transparent;
    border: none;
    font-size: 0.72rem;
    font-weight: 600;
    color: #94a3b8;
    padding: 2px 6px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .tab-btn.active {
    background: rgba(56, 189, 248, 0.15);
    color: #38bdf8;
  }

  .collapse-btn {
    background: transparent;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    font-size: 0.75rem;
    padding: 2px 4px;
  }

  .layer-toggles-grid {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .layer-toggle-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 5px 8px;
    border-radius: 6px;
    background: rgba(30, 41, 59, 0.4);
    border: 1px solid rgba(148, 163, 184, 0.08);
  }

  .layer-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .layer-indicator {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .flight-ind { background-color: #38bdf8; }
  .marine-ind { background-color: #2dd4bf; }
  .quake-ind { background-color: #fb923c; }
  .firms-ind { background-color: #f43f5e; }
  .gbfs-ind { background-color: #818cf8; }
  .cctv-ind { background-color: #a855f7; }
  .radio-ind { background-color: #06b6d4; }
  .launch-ind { background-color: #facc15; }
  .weather-ind { background-color: #60a5fa; }

  .layer-text {
    display: flex;
    flex-direction: column;
  }

  .layer-name {
    font-size: 0.76rem;
    font-weight: 600;
    color: #f1f5f9;
  }

  .layer-sub {
    font-size: 0.63rem;
    color: #94a3b8;
  }

  /* Switches */
  .switch {
    position: relative;
    display: inline-block;
    width: 34px;
    height: 18px;
  }

  .switch input {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
    z-index: 2;
    margin: 0;
  }

  .slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(100, 116, 139, 0.4);
    border-radius: 18px;
    transition: 0.2s;
  }

  .slider:before {
    position: absolute;
    content: "";
    height: 12px;
    width: 12px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    border-radius: 50%;
    transition: 0.2s;
  }

  input:checked + .flight-slider { background-color: #38bdf8; }
  input:checked + .marine-slider { background-color: #2dd4bf; }
  input:checked + .quake-slider { background-color: #fb923c; }
  input:checked + .firms-slider { background-color: #f43f5e; }
  input:checked + .gbfs-slider { background-color: #818cf8; }
  input:checked + .cctv-slider { background-color: #a855f7; }
  input:checked + .radio-slider { background-color: #06b6d4; }
  input:checked + .launch-slider { background-color: #facc15; }
  input:checked + .weather-slider { background-color: #60a5fa; }

  input:checked + .slider:before {
    transform: translateX(16px);
  }

  /* Filters */
  .filters-container {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  .filter-group {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .filter-group-header {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .channel-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .quake-dot { background-color: #fb923c; }
  .firms-dot { background-color: #f43f5e; }
  .marine-dot { background-color: #2dd4bf; }
  .cctv-dot { background-color: #a855f7; }
  .radio-dot { background-color: #06b6d4; }

  .filter-title {
    font-size: 0.68rem;
    font-weight: 600;
    color: #cbd5e1;
  }

  .filter-options-row {
    display: flex;
    gap: 4px;
  }

  .filter-chip {
    flex: 1;
    background: rgba(30, 41, 59, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.15);
    border-radius: 4px;
    color: #94a3b8;
    font-size: 0.65rem;
    padding: 3px 5px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .filter-chip.active {
    background: rgba(56, 189, 248, 0.2);
    border-color: #38bdf8;
    color: #f8fafc;
    font-weight: 600;
  }

  .panel-footer-meta {
    margin-top: 10px;
    padding-top: 6px;
    border-top: 1px solid rgba(148, 163, 184, 0.1);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .meta-tag {
    font-size: 0.60rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    color: #10b981;
    background: rgba(16, 185, 129, 0.1);
    padding: 2px 4px;
    border-radius: 3px;
  }

  .meta-desc {
    font-size: 0.60rem;
    color: #64748b;
  }
</style>
