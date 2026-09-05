<script lang="ts">
  let { data }: { data: Record<string, unknown> } = $props();
</script>

<div class="telemetry-grid">
  <div class="metric-row">
    <span class="label">Catalog ID</span>
    <span class="value mono highlight">{data.catalogId ?? data.catalog_id ?? 'N/A'}</span>
  </div>
  <div class="metric-row">
    <span class="label">Source Group</span>
    <span class="value mono">{data.sourceGroup ?? data.source_group ?? 'N/A'}</span>
  </div>
  <div class="metric-row">
    <span class="label">Estimated Altitude</span>
    <span class="value mono">{(Number(data.altitudeM ?? data.altitude_m ?? 0) / 1_000).toFixed(1)} km</span>
  </div>
  <div class="metric-row">
    <span class="label">Estimated Speed</span>
    <span class="value mono">{(Number(data.speedMps ?? data.speed_mps ?? 0) / 1_000).toFixed(2)} km/s</span>
  </div>
  <div class="metric-row full-width">
    <span class="label">Element Epoch</span>
    <span class="value mono">{data.elementEpoch ?? data.element_epoch ?? 'N/A'}</span>
  </div>
  <div class="metric-row full-width estimate-notice">
    <span class="label">Use Limitation</span>
    <span class="value">{data.usageNotice ?? 'Propagated estimate; not live and not for navigation, conjunction assessment, or collision avoidance.'}</span>
  </div>
</div>

<style>
  .telemetry-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .metric-row { display: flex; flex-direction: column; gap: 2px; }
  .full-width { grid-column: span 2; }
  .label {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--hud-text-secondary);
  }
  .value { font-size: 0.82rem; color: var(--hud-text-panel); }
  .mono { font-family: ui-monospace, 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
  .highlight { color: var(--channel-satellites); font-weight: 600; }
  .estimate-notice { border-top: 1px solid var(--hud-border-muted); padding-top: 6px; }
</style>
