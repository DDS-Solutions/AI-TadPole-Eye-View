<script lang="ts">
  let {
    kind,
    data,
  }: {
    kind: 'tropical-cyclone' | 'coastal-condition';
    data: Record<string, unknown>;
  } = $props();

  function display(value: unknown): string {
    return value === null || value === undefined || value === '' ? 'NOT REPORTED' : String(value);
  }

  function measurement(value: unknown): string {
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : 'NOT REPORTED';
  }

  function current(speed: unknown, direction: unknown): string {
    return typeof speed === 'number' && typeof direction === 'number'
      ? `${speed} @ ${direction}°`
      : 'NOT REPORTED';
  }
</script>

<div class="telemetry-grid">
  {#if kind === 'tropical-cyclone'}
    <div class="metric-row">
      <span class="label">Storm / Advisory</span>
      <span class="value mono">{display(data.storm_id)} / {display(data.advisory_number)}</span>
    </div>
    <div class="metric-row">
      <span class="label">Product</span>
      <span class="value mono">{display(data.product).replaceAll('_', ' ').toUpperCase()}</span>
    </div>
    <div class="metric-row full-width">
      <span class="label">Observation time</span>
      <span class="value mono">{display(data.observation_time)}</span>
    </div>
    <div class="metric-row full-width">
      <span class="label">Advisory issued</span>
      <span class="value mono">{display(data.issued_at)}</span>
    </div>
    <div class="metric-row full-width">
      <span class="label">Source validity</span>
      <span class="value mono">{display(data.valid_from)} → {display(data.valid_to)}</span>
    </div>
    {#if data.warning_type}
      <div class="metric-row full-width">
        <span class="label">Watch / warning</span>
        <span class="value mono warning">{display(data.warning_type)}</span>
      </div>
    {/if}
    <p class="notice full-width">Forecast track and cone communicate uncertainty. NOAA/NHC/CPHC experimental GIS data is not for navigation or life-safety decisions.</p>
  {:else}
    <div class="metric-row">
      <span class="label">Station</span>
      <span class="value mono">{display(data.stationId)}</span>
    </div>
    <div class="metric-row">
      <span class="label">Datum / units</span>
      <span class="value mono">{display(data.datum)} / {display(data.units).toUpperCase()}</span>
    </div>
    <div class="metric-row full-width">
      <span class="label">Time zone</span>
      <span class="value mono">{display(data.timeZone).toUpperCase()} · {display(data.stationTimeZoneName)}</span>
    </div>
    <div class="metric-row">
      <span class="label">Observed water level</span>
      <span class="value mono">{measurement(data.latestWaterLevel)} · {display(data.latestWaterLevelQuality)}</span>
    </div>
    <div class="metric-row">
      <span class="label">Observed at</span>
      <span class="value mono">{display(data.latestWaterLevelObservedAt)}</span>
    </div>
    <div class="metric-row">
      <span class="label">Predicted tide</span>
      <span class="value mono">{measurement(data.nextTideLevel)}</span>
    </div>
    <div class="metric-row">
      <span class="label">Prediction valid at</span>
      <span class="value mono">{display(data.nextTideValidAt)}</span>
    </div>
    <div class="metric-row">
      <span class="label">Observed current</span>
      <span class="value mono">{current(data.latestCurrentSpeed, data.latestCurrentDirection)}</span>
    </div>
    <div class="metric-row">
      <span class="label">Predicted current</span>
      <span class="value mono">{current(data.nextCurrentSpeed, data.nextCurrentDirection)}</span>
    </div>
    <div class="metric-row full-width">
      <span class="label">Metadata retrieved</span>
      <span class="value mono">{display(data.metadataRetrievedAt)}</span>
    </div>
    <p class="notice full-width">NOAA/NOS/CO-OPS observations may be preliminary; predictions are separate guidance. Not for navigation.</p>
  {/if}
</div>

<style>
  .telemetry-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .metric-row { display: flex; flex-direction: column; gap: 2px; }
  .full-width { grid-column: span 2; }
  .label { color: var(--hud-text-secondary); font-size: 0.65rem; letter-spacing: 0.04em; text-transform: uppercase; }
  .value { color: var(--hud-text-data); font-size: 0.76rem; }
  .mono { font-family: ui-monospace, 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
  .warning { color: var(--hud-danger); font-weight: 600; }
  .notice { margin: 4px 0 0; color: var(--hud-text-dim); font-size: 0.62rem; line-height: 1.4; }
</style>
