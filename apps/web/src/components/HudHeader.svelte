<script lang="ts">
  import { onDestroy } from 'svelte';
  import { layerStore } from '../stores/layers.svelte.js';

  let currentTime = $state(new Date().toUTCString());
  let timer: ReturnType<typeof setInterval> | null = null;

  if (typeof window !== 'undefined') {
    timer = setInterval(() => {
      currentTime = new Date().toUTCString();
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
    background: rgba(15, 23, 42, 0.85);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 8px;
    padding: 10px 16px;
    pointer-events: auto;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
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
    color: #f8fafc;
  }

  .version-badge {
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(56, 189, 248, 0.15);
    color: #38bdf8;
    border: 1px solid rgba(56, 189, 248, 0.3);
  }

  .table-toggle-btn {
    background: rgba(30, 41, 59, 0.8);
    border: 1px solid rgba(56, 189, 248, 0.3);
    color: #38bdf8;
    font-size: 0.68rem;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .table-toggle-btn:hover {
    background: rgba(56, 189, 248, 0.2);
    border-color: #38bdf8;
  }

  .table-toggle-btn.active {
    background: #38bdf8;
    color: #030712;
    font-weight: 700;
  }

  .hud-status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.75rem;
    color: #94a3b8;
  }

  .status-indicator {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background-color: #10b981;
    box-shadow: 0 0 8px #10b981;
    display: inline-block;
  }

  .divider {
    color: rgba(148, 163, 184, 0.3);
  }

  .clock-display {
    font-family: ui-monospace, 'JetBrains Mono', monospace;
    font-size: 0.72rem;
    color: #cbd5e1;
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
    background: rgba(15, 23, 42, 0.85);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 8px;
    padding: 6px 10px;
    display: flex;
    align-items: center;
    gap: 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    transition: opacity 0.2s ease, border-color 0.2s ease;
  }

  .stat-badge.inactive {
    opacity: 0.4;
    border-color: rgba(148, 163, 184, 0.08);
  }

  .channel-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }

  /* Strict DESIGN.md §2.2 Telemetry Channel Color Laws */
  .flight-dot { background-color: #38bdf8; box-shadow: 0 0 6px #38bdf8; }
  .flight-channel .stat-value { color: #38bdf8; }

  .marine-dot { background-color: #2dd4bf; box-shadow: 0 0 6px #2dd4bf; }
  .marine-channel .stat-value { color: #2dd4bf; }

  .quake-dot { background-color: #fb923c; box-shadow: 0 0 6px #fb923c; }
  .quake-channel .stat-value { color: #fb923c; }

  .firms-dot { background-color: #f43f5e; box-shadow: 0 0 6px #f43f5e; }
  .firms-channel .stat-value { color: #f43f5e; }

  .gbfs-dot { background-color: #818cf8; box-shadow: 0 0 6px #818cf8; }
  .gbfs-channel .stat-value { color: #818cf8; }

  .cctv-dot { background-color: #a855f7; box-shadow: 0 0 6px #a855f7; }
  .cctv-channel .stat-value { color: #a855f7; }

  .radio-dot { background-color: #06b6d4; box-shadow: 0 0 6px #06b6d4; }
  .radio-channel .stat-value { color: #06b6d4; }

  .launch-dot { background-color: #facc15; box-shadow: 0 0 6px #facc15; }
  .launch-channel .stat-value { color: #facc15; }

  .weather-dot { background-color: #60a5fa; box-shadow: 0 0 6px #60a5fa; }
  .weather-channel .stat-value { color: #60a5fa; }

  .total-channel .stat-value { color: #f8fafc; }

  .stat-label {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #94a3b8;
  }

  .stat-value {
    font-family: ui-monospace, 'JetBrains Mono', monospace;
    font-size: 0.88rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
</style>
