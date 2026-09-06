<script lang="ts">
  import type { DataFreshness } from '@gev/contracts';
  import { layerStore } from '../stores/layers.svelte.js';

  let collapsed = $state(false);

  function freshnessLabel(layer: 'solar' | 'alerts' | 'aviationWeather'): string {
    const freshness: DataFreshness | undefined = layerStore.provenance[layer]?.freshness;
    if (!freshness) return layerStore.activeErrors[layer] ? 'SOURCE UNAVAILABLE' : 'AWAITING';
    if (freshness.status === 'unavailable') return 'SOURCE UNAVAILABLE';
    return `${freshness.status.toUpperCase()} · ${Math.round(freshness.age_seconds)}s`;
  }

  const alertState = $derived(
    layerStore.activeErrors.alerts
      ? 'SOURCE UNAVAILABLE'
      : layerStore.counts.alerts === 0
        ? 'NO EVENTS IN AOI'
        : freshnessLabel('alerts')
  );
  const aviationState = $derived(
    layerStore.activeErrors.aviationWeather
      ? 'SOURCE UNAVAILABLE'
      : layerStore.counts.aviationWeather === 0
        ? 'NO EVENTS IN AOI'
        : freshnessLabel('aviationWeather')
  );
</script>

<aside id="operational-awareness-panel" class:collapsed aria-label="Operational awareness layers">
  <header>
    <div>
      <span class="eyebrow">SIMCLOCK + OFFICIAL SOURCES</span>
      <h2>Operational Awareness</h2>
    </div>
    <button
      id="toggle-operational-panel"
      type="button"
      onclick={() => (collapsed = !collapsed)}
      aria-expanded={!collapsed}
      aria-label={collapsed ? 'Expand operational awareness' : 'Collapse operational awareness'}
    >{collapsed ? '◀' : '▼'}</button>
  </header>

  {#if !collapsed}
    <div class="aoi" id="operational-aoi-summary">
      <span>AOI INSPECTION</span>
      <strong>{layerStore.operationalAoi.min_lat}°…{layerStore.operationalAoi.max_lat}° N · {layerStore.operationalAoi.min_lon}°…{layerStore.operationalAoi.max_lon}° E</strong>
    </div>

    <div class="rows">
      <div class="row" id="solar-context-row">
        <span class="indicator solar"></span>
        <div class="copy">
          <strong>Solar Context</strong>
          <span id="solar-context-status">{freshnessLabel('solar')}</span>
          {#if layerStore.operationalEntities.solar}
            <small class="mono">N {layerStore.operationalEntities.solar.north_pole.replaceAll('_', ' ')} · S {layerStore.operationalEntities.solar.south_pole.replaceAll('_', ' ')}</small>
          {/if}
        </div>
        <label class="switch">
          <input id="toggle-solar" type="checkbox" checked={layerStore.visibility.solar} onchange={() => layerStore.toggleLayer('solar')} />
          <span></span>
        </label>
      </div>

      <div class="row" id="nws-alert-row">
        <span class="indicator alert"></span>
        <div class="copy">
          <strong>NWS CAP Alerts <b id="nws-alert-count">{layerStore.counts.alerts}</b></strong>
          <span id="nws-alert-status">{alertState}</span>
          <small>NOAA / National Weather Service</small>
        </div>
        <label class="switch">
          <input id="toggle-nws-alerts" type="checkbox" checked={layerStore.visibility.alerts} onchange={() => layerStore.toggleLayer('alerts')} />
          <span></span>
        </label>
      </div>

      <div class="row" id="aviation-weather-row">
        <span class="indicator aviation"></span>
        <div class="copy">
          <strong>AWC METAR / TAF / SIGMET <b id="aviation-weather-count">{layerStore.counts.aviationWeather}</b></strong>
          <span id="aviation-weather-status">{aviationState}</span>
          <small>Aviation Weather Center · validity enforced</small>
        </div>
        <label class="switch">
          <input id="toggle-aviation-weather" type="checkbox" checked={layerStore.visibility.aviationWeather} onchange={() => layerStore.toggleLayer('aviationWeather')} />
          <span></span>
        </label>
      </div>
    </div>

    <p class="notice">Synthetic seed records are for visualization tests only. Always follow official operational guidance.</p>
  {/if}
</aside>

<style>
  aside {
    position: absolute;
    top: 85px;
    right: 16px;
    width: 320px;
    padding: 12px;
    z-index: 12;
    pointer-events: auto;
    color: var(--hud-text-primary);
    background: var(--hud-panel-bg);
    border: 1px solid var(--hud-border);
    border-radius: 8px;
    backdrop-filter: blur(12px);
    box-shadow: 0 8px 24px var(--hud-shadow-soft);
  }

  aside.collapsed { width: 230px; }
  header, .row, .aoi { display: flex; align-items: center; }
  header { justify-content: space-between; gap: 12px; }
  h2 { margin: 2px 0 0; font-size: 0.84rem; letter-spacing: -0.01em; }
  .eyebrow { color: var(--hud-text-secondary); font: 600 0.57rem ui-monospace, monospace; letter-spacing: 0.08em; }
  button { border: 0; background: transparent; color: var(--hud-text-secondary); cursor: pointer; }

  .aoi {
    justify-content: space-between;
    gap: 12px;
    margin: 10px 0 8px;
    padding: 7px 8px;
    border: 1px solid var(--hud-border-faint);
    border-radius: 5px;
    background: var(--hud-surface-dark-soft);
  }
  .aoi span, .aoi strong { font: 0.58rem ui-monospace, monospace; }
  .aoi span { color: var(--hud-text-secondary); }
  .aoi strong { color: var(--hud-text-data); text-align: right; }

  .rows { display: grid; gap: 7px; }
  .row { gap: 8px; padding: 8px; background: var(--hud-row-bg); border: 1px solid var(--hud-border-faint); border-radius: 6px; }
  .indicator { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; }
  .indicator.solar { background: var(--hud-text-primary); }
  .indicator.alert { background: var(--hud-danger); }
  .indicator.aviation { background: var(--channel-flight); }
  .copy { min-width: 0; flex: 1; display: grid; gap: 2px; }
  .copy strong { color: var(--hud-text-panel); font-size: 0.7rem; }
  .copy strong b { color: var(--hud-text-data); font: 600 0.64rem ui-monospace, monospace; }
  .copy span, .copy small { color: var(--hud-text-secondary); font-size: 0.58rem; }
  .copy span { font-family: ui-monospace, monospace; }
  .mono { text-transform: uppercase; }
  .notice { margin: 8px 2px 0; color: var(--hud-text-dim); font-size: 0.57rem; line-height: 1.35; }

  .switch { position: relative; width: 32px; height: 17px; flex: 0 0 auto; }
  .switch input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; z-index: 2; }
  .switch span { position: absolute; inset: 0; border-radius: 17px; background: var(--hud-switch-off); }
  .switch span::before { content: ''; position: absolute; width: 11px; height: 11px; left: 3px; top: 3px; border-radius: 50%; background: var(--hud-switch-knob); transition: transform 0.15s ease; }
  .switch input:checked + span { background: var(--hud-accent); }
  .switch input:checked + span::before { transform: translateX(15px); }
</style>
