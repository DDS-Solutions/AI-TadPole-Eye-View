<script lang="ts">
  import { layerStore } from '../stores/layers.svelte.js';
  import LayerFilterControls from './LayerFilterControls.svelte';
  import ProvenanceBadges from './ProvenanceBadges.svelte';

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
        <LayerFilterControls />
      {/if}

      <ProvenanceBadges />
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
    background: var(--hud-panel-bg-strong);
    backdrop-filter: blur(14px);
    border: 1px solid var(--hud-border);
    border-radius: 10px;
    padding: 14px;
    pointer-events: auto;
    z-index: 20;
    box-shadow: 0 8px 32px var(--hud-shadow);
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
    border-bottom: 1px solid var(--hud-border-muted);
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
    color: var(--hud-text-primary);
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
    color: var(--hud-text-secondary);
    padding: 2px 6px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .tab-btn.active {
    background: var(--hud-accent-soft);
    color: var(--hud-accent);
  }

  .collapse-btn {
    background: transparent;
    border: none;
    color: var(--hud-text-secondary);
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
    background: var(--hud-row-bg);
    border: 1px solid var(--hud-border-faint);
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

  .flight-ind { background-color: var(--channel-flight); }
  .marine-ind { background-color: var(--channel-marine); }
  .quake-ind { background-color: var(--channel-quake); }
  .firms-ind { background-color: var(--channel-firms); }
  .gbfs-ind { background-color: var(--channel-gbfs); }
  .cctv-ind { background-color: var(--channel-cctv); }
  .radio-ind { background-color: var(--channel-radio); }
  .launch-ind { background-color: var(--channel-launch); }
  .weather-ind { background-color: var(--channel-weather); }

  .layer-text {
    display: flex;
    flex-direction: column;
  }

  .layer-name {
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--hud-text-panel);
  }

  .layer-sub {
    font-size: 0.63rem;
    color: var(--hud-text-secondary);
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
    background-color: var(--hud-switch-off);
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
    background-color: var(--hud-switch-knob);
    border-radius: 50%;
    transition: 0.2s;
  }

  input:checked + .flight-slider { background-color: var(--channel-flight); }
  input:checked + .marine-slider { background-color: var(--channel-marine); }
  input:checked + .quake-slider { background-color: var(--channel-quake); }
  input:checked + .firms-slider { background-color: var(--channel-firms); }
  input:checked + .gbfs-slider { background-color: var(--channel-gbfs); }
  input:checked + .cctv-slider { background-color: var(--channel-cctv); }
  input:checked + .radio-slider { background-color: var(--channel-radio); }
  input:checked + .launch-slider { background-color: var(--channel-launch); }
  input:checked + .weather-slider { background-color: var(--channel-weather); }

  input:checked + .slider:before {
    transform: translateX(16px);
  }

</style>
