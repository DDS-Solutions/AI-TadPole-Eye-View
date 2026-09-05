<script lang="ts">
  import { onDestroy } from 'svelte';
  import { runtimeClock } from '../runtimeClock.js';
  import { layerStore } from '../stores/layers.svelte.js';

  let currentTime = $state(new Date(runtimeClock.now()).toUTCString());
  let timer: ReturnType<typeof setInterval> | null = null;

  if (typeof window !== 'undefined') {
    timer = setInterval(() => {
      currentTime = new Date(runtimeClock.now()).toUTCString();
    }, 1000);
  }

  onDestroy(() => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  });
</script>

<header class="hud-header">
  <div class="hud-title-card">
    <div class="title-row">
      <h1 id="app-title">GEV v2 — God's Eye View</h1>
      <span class="version-badge">OSINT CONSOLE</span>
      <button
        id="toggle-telemetry-table-btn"
        class="table-toggle-btn"
        class:active={layerStore.isTableOpen}
        onclick={() => layerStore.toggleTable()}
        title="Toggle High-Density Telemetry Table"
      >
        📊 {layerStore.isTableOpen ? 'Hide Table' : 'Telemetry Table'}
      </button>
    </div>
    <div id="app-status" class="hud-status">
      <span class="status-indicator"></span>
      <span class="status-text">{layerStore.statusText}</span>
      <span class="divider">|</span>
      <span class="clock-display">{currentTime}</span>
    </div>
  </div>

  <div class="hud-stats-ribbon">
    <div class="stat-badge flight-channel" class:inactive={!layerStore.visibility.flights}>
      <span class="channel-dot flight-dot"></span>
      <span class="stat-label">ADS-B Flights</span>
      <span id="flight-count" class="stat-value">{layerStore.counts.flights}</span>
    </div>

    <div class="stat-badge marine-channel" class:inactive={!layerStore.visibility.marine}>
      <span class="channel-dot marine-dot"></span>
      <span class="stat-label">AIS Ships</span>
      <span id="ship-count" class="stat-value">{layerStore.counts.marine}</span>
    </div>

    <div class="stat-badge quake-channel" class:inactive={!layerStore.visibility.quakes}>
      <span class="channel-dot quake-dot"></span>
      <span class="stat-label">USGS Quakes</span>
      <span id="quake-count" class="stat-value">{layerStore.counts.quakes}</span>
    </div>

    <div class="stat-badge firms-channel" class:inactive={!layerStore.visibility.firms}>
      <span class="channel-dot firms-dot"></span>
      <span class="stat-label">NASA FIRMS</span>
      <span id="firms-count" class="stat-value">{layerStore.counts.firms}</span>
    </div>

    <div class="stat-badge gbfs-channel" class:inactive={!layerStore.visibility.gbfs}>
      <span class="channel-dot gbfs-dot"></span>
      <span class="stat-label">GBFS Transit</span>
      <span id="gbfs-count" class="stat-value">{layerStore.counts.gbfs}</span>
    </div>

    <div class="stat-badge cctv-channel" class:inactive={!layerStore.visibility.cctv}>
      <span class="channel-dot cctv-dot"></span>
      <span class="stat-label">CCTV Feeds</span>
      <span id="cctv-count" class="stat-value">{layerStore.counts.cctv}</span>
    </div>

    <div class="stat-badge radio-channel" class:inactive={!layerStore.visibility.radio}>
      <span class="channel-dot radio-dot"></span>
      <span class="stat-label">Radio & ATC</span>
      <span id="radio-count" class="stat-value">{layerStore.counts.radio}</span>
    </div>

    <div class="stat-badge launch-channel" class:inactive={!layerStore.visibility.launches}>
      <span class="channel-dot launch-dot"></span>
      <span class="stat-label">Launches</span>
      <span id="launch-count" class="stat-value">{layerStore.counts.launches}</span>
    </div>

    <div class="stat-badge weather-channel" class:inactive={!layerStore.visibility.weather}>
      <span class="channel-dot weather-dot"></span>
      <span class="stat-label">Weather Radar</span>
      <span id="weather-count" class="stat-value">{layerStore.counts.weather}</span>
    </div>

    <div class="stat-badge satellite-channel" class:inactive={!layerStore.visibility.satellites}>
      <span class="channel-dot satellite-dot"></span>
      <span class="stat-label">Sat Estimates</span>
      <span id="satellite-header-count" class="stat-value">{layerStore.counts.satellites}</span>
    </div>

    <div class="stat-badge total-channel">
      <span class="stat-label">Total Visible</span>
      <span id="total-count" class="stat-value">{layerStore.totalCount}</span>
    </div>
  </div>
</header>

<style>
  .hud-header {
    position: absolute;
    top: 16px;
    left: 16px;
    right: 16px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    pointer-events: none;
    z-index: 20;
  }

  .hud-title-card {
    background: var(--hud-panel-bg);
    backdrop-filter: blur(12px);
    border: 1px solid var(--hud-border);
    border-radius: 8px;
    padding: 10px 16px;
    pointer-events: auto;
    box-shadow: 0 4px 20px var(--hud-shadow-medium);
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 4px;
  }

  #app-title {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--hud-text-primary);
  }

  .version-badge {
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--hud-accent-soft);
    color: var(--hud-accent);
    border: 1px solid var(--hud-accent-border);
  }

  .table-toggle-btn {
    background: var(--hud-chip-bg-strong);
    border: 1px solid var(--hud-accent-border);
    color: var(--hud-accent);
    font-size: 0.68rem;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .table-toggle-btn:hover {
    background: var(--hud-accent-selected);
    border-color: var(--hud-accent);
  }

  .table-toggle-btn.active {
    background: var(--hud-accent);
    color: var(--hud-surface-dark);
    font-weight: 700;
  }

  .hud-status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.75rem;
    color: var(--hud-text-secondary);
  }

  .status-indicator {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background-color: var(--hud-success);
    box-shadow: 0 0 8px var(--hud-success);
    display: inline-block;
  }

  .divider {
    color: var(--hud-border-solid-soft);
  }

  .clock-display {
    font-family: ui-monospace, 'JetBrains Mono', monospace;
    font-size: 0.72rem;
    color: var(--hud-text-mid);
    font-variant-numeric: tabular-nums;
  }

  .hud-stats-ribbon {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-end;
    pointer-events: auto;
    max-width: 65vw;
  }

  .stat-badge {
    background: var(--hud-panel-bg);
    backdrop-filter: blur(12px);
    border: 1px solid var(--hud-border);
    border-radius: 8px;
    padding: 6px 10px;
    display: flex;
    align-items: center;
    gap: 6px;
    box-shadow: 0 4px 16px var(--hud-shadow-soft);
    transition: opacity 0.2s ease, border-color 0.2s ease;
  }

  .stat-badge.inactive {
    opacity: 0.4;
    border-color: var(--hud-border-faint);
  }

  .channel-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }

  /* Strict DESIGN.md §2.2 Telemetry Channel Color Laws */
  .flight-dot { background-color: var(--channel-flight); box-shadow: 0 0 6px var(--channel-flight); }
  .flight-channel .stat-value { color: var(--channel-flight); }

  .marine-dot { background-color: var(--channel-marine); box-shadow: 0 0 6px var(--channel-marine); }
  .marine-channel .stat-value { color: var(--channel-marine); }

  .quake-dot { background-color: var(--channel-quake); box-shadow: 0 0 6px var(--channel-quake); }
  .quake-channel .stat-value { color: var(--channel-quake); }

  .firms-dot { background-color: var(--channel-firms); box-shadow: 0 0 6px var(--channel-firms); }
  .firms-channel .stat-value { color: var(--channel-firms); }

  .gbfs-dot { background-color: var(--channel-gbfs); box-shadow: 0 0 6px var(--channel-gbfs); }
  .gbfs-channel .stat-value { color: var(--channel-gbfs); }

  .cctv-dot { background-color: var(--channel-cctv); box-shadow: 0 0 6px var(--channel-cctv); }
  .cctv-channel .stat-value { color: var(--channel-cctv); }

  .radio-dot { background-color: var(--channel-radio); box-shadow: 0 0 6px var(--channel-radio); }
  .radio-channel .stat-value { color: var(--channel-radio); }

  .launch-dot { background-color: var(--channel-launch); box-shadow: 0 0 6px var(--channel-launch); }
  .launch-channel .stat-value { color: var(--channel-launch); }

  .weather-dot { background-color: var(--channel-weather); box-shadow: 0 0 6px var(--channel-weather); }
  .weather-channel .stat-value { color: var(--channel-weather); }

  .satellite-dot { background-color: var(--channel-satellites); box-shadow: 0 0 6px var(--channel-satellites); }
  .satellite-channel .stat-value { color: var(--channel-satellites); }

  .total-channel .stat-value { color: var(--hud-text-primary); }

  .stat-label {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--hud-text-secondary);
  }

  .stat-value {
    font-family: ui-monospace, 'JetBrains Mono', monospace;
    font-size: 0.88rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
</style>
