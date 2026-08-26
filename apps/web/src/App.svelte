<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { GlobeController, FlightLayerController, attachDebugBus } from '@gev/cesium-kit';
  import type { FlightBatch } from '@gev/contracts';

  let globeContainer: HTMLDivElement;
  let globe: GlobeController | null = null;
  let flightLayer: FlightLayerController | null = null;

  let flightCount = $state(0);
  let statusText = $state('Initializing Globe...');
  let lastUpdateTime = $state('');
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  async function pollFlights() {
    try {
      const response = await fetch('/api/flights');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data: FlightBatch = await response.json();
      if (flightLayer && data.states) {
        flightLayer.enqueueBatch(data);
        requestAnimationFrame(() => {
          flightCount = flightLayer?.getEntityCount() ?? 0;
        });
        lastUpdateTime = new Date().toLocaleTimeString();
        statusText = 'Connected (Keyless OpenStreetMap)';
      }
    } catch (err: unknown) {
      statusText = `Feed Error: ${err instanceof Error ? err.message : 'Disconnected'}`;
    }
  }

  onMount(async () => {
    try {
      globe = new GlobeController({ container: globeContainer });
      flightLayer = new FlightLayerController({ viewer: globe.viewer });
      attachDebugBus(globe, flightLayer);

      // Initial poll immediately
      await pollFlights();

      // Poll at 5-second human-rate cadence (ADR-0015)
      pollInterval = setInterval(pollFlights, 5000);
    } catch (err: unknown) {
      statusText = `Init Error: ${err instanceof Error ? err.message : 'Unknown'}`;
    }
  });

  onDestroy(() => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    flightLayer?.destroy();
    globe?.destroy();
  });
</script>

<main class="app-layout">
  <div bind:this={globeContainer} id="globe-container" class="globe-viewport"></div>

  <!-- HUD Overlay -->
  <header class="hud-header">
    <div class="hud-title-card">
      <h1 id="app-title">GEV v2 — God's Eye View</h1>
      <div id="app-status" class="hud-status">
        <span class="status-indicator"></span>
        {statusText}
      </div>
    </div>

    <div class="hud-stats-card">
      <div class="stat-item">
        <span class="stat-label">Active Aircraft</span>
        <span id="flight-count" class="stat-value">{flightCount}</span>
      </div>
      {#if lastUpdateTime}
        <div class="stat-item">
          <span class="stat-label">Last Sync</span>
          <span class="stat-value">{lastUpdateTime}</span>
        </div>
      {/if}
    </div>
  </header>

  <!-- OpenStreetMap Mandatory Attribution (Rule 3) -->
  <footer id="osm-attribution" class="attribution-badge">
    Map data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors
  </footer>
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background-color: #030712;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    color: #f3f4f6;
  }

  .app-layout {
    position: relative;
    width: 100vw;
    height: 100vh;
  }

  .globe-viewport {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }

  .hud-header {
    position: absolute;
    top: 16px;
    left: 16px;
    right: 16px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    pointer-events: none;
    z-index: 10;
  }

  .hud-title-card, .hud-stats-card {
    background: rgba(17, 24, 39, 0.85);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(75, 85, 99, 0.4);
    border-radius: 8px;
    padding: 12px 16px;
    pointer-events: auto;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  #app-title {
    margin: 0 0 4px 0;
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: #f9fafb;
  }

  .hud-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8rem;
    color: #9ca3af;
  }

  .status-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: #10b981;
    display: inline-block;
  }

  .hud-stats-card {
    display: flex;
    gap: 16px;
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }

  .stat-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #9ca3af;
  }

  .stat-value {
    font-size: 1.1rem;
    font-weight: 700;
    color: #38bdf8;
    font-variant-numeric: tabular-nums;
  }

  .attribution-badge {
    position: absolute;
    bottom: 8px;
    right: 8px;
    background: rgba(17, 24, 39, 0.75);
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 0.7rem;
    color: #9ca3af;
    pointer-events: auto;
    z-index: 10;
  }

  .attribution-badge a {
    color: #60a5fa;
    text-decoration: none;
  }

  .attribution-badge a:hover {
    text-decoration: underline;
  }
</style>
