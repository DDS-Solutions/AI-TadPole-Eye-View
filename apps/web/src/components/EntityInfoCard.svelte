<script lang="ts">
  import { WEB_CHANNEL_COLORS } from '../designTokens.js';
  import { getFlightTimeSeries, getLaunchTimeSeries, getWeatherTimeSeries } from '../entityChartData.js';
  import { layerStore } from '../stores/layers.svelte.js';
  import SatelliteEntityDetails from './SatelliteEntityDetails.svelte';
  import TelemetryTimelineChart from './TelemetryTimelineChart.svelte';

  const entity = $derived(layerStore.selectedEntity);
  let audioPlayer = $state<HTMLAudioElement | null>(null);

</script>

{#if entity}
  <section
    id="entity-info-card"
    class="entity-card"
    class:kind-flight={entity.kind === 'flight'}
    class:kind-marine={entity.kind === 'marine'}
    class:kind-quake={entity.kind === 'quake'}
    class:kind-firms={entity.kind === 'firms'}
    class:kind-gbfs={entity.kind === 'gbfs'}
    class:kind-cctv={entity.kind === 'cctv'}
    class:kind-radio={entity.kind === 'radio'}
    class:kind-launch={entity.kind === 'launch'}
    class:kind-weather={entity.kind === 'weather'}
    class:kind-satellite={entity.kind === 'satellite'}
  >
    <div class="card-header">
      <div class="header-main">
        <span class="kind-badge">{entity.kind.toUpperCase()}</span>
        <h3 id="entity-title" class="entity-title">{entity.name}</h3>
      </div>
      <button
        id="close-entity-card-btn"
        class="close-btn"
        onclick={() => layerStore.clearSelection()}
        title="Close inspector"
      >
        ✕
      </button>
    </div>

    <div class="card-body">
      {#if entity.kind === 'flight'}
        <div class="telemetry-grid">
          <div class="metric-row">
            <span class="label">ICAO24</span>
            <span class="value mono">{entity.data.icao24 ?? 'N/A'}</span>
          </div>
          <div class="metric-row">
            <span class="label">Callsign</span>
            <span class="value mono">{entity.data.callsign ?? 'N/A'}</span>
          </div>
          <div class="metric-row">
            <span class="label">Altitude</span>
            <span class="value mono">{(entity.data.baro_altitude ?? entity.data.geo_altitude ?? 0)} m</span>
          </div>
          <div class="metric-row">
            <span class="label">Velocity</span>
            <span class="value mono">{(entity.data.velocity ?? 0)} m/s</span>
          </div>
          <div class="metric-row">
            <span class="label">Track / Heading</span>
            <span class="value mono">{(entity.data.true_track ?? 0)}°</span>
          </div>
          <div class="metric-row">
            <span class="label">Squawk</span>
            <span class="value mono">{entity.data.squawk ?? 'N/A'}</span>
          </div>
        </div>

        <TelemetryTimelineChart
          title="Altitude & Velocity Profile"
          xAxisLabel="Time (s)"
          data={getFlightTimeSeries(entity.data)}
          seriesConfigs={[
            { label: 'Altitude (m)', stroke: WEB_CHANNEL_COLORS.flight, valueFormat: (v) => `${v.toFixed(0)}m` },
            { label: 'Velocity (m/s)', stroke: WEB_CHANNEL_COLORS.marine, valueFormat: (v) => `${v.toFixed(0)}m/s` },
          ]}
          height={120}
        />
      {:else if entity.kind === 'marine'}
        <div class="telemetry-grid">
          <div class="metric-row">
            <span class="label">MMSI</span>
            <span class="value mono">{entity.data.mmsi ?? 'N/A'}</span>
          </div>
          <div class="metric-row">
            <span class="label">Vessel Type</span>
            <span class="value mono highlight-teal">{entity.data.ship_type ?? 'Unknown'}</span>
          </div>
          <div class="metric-row">
            <span class="label">Nav Status</span>
            <span class="value mono">{entity.data.nav_status ?? 'Underway'}</span>
          </div>
          <div class="metric-row">
            <span class="label">Speed Over Ground</span>
            <span class="value mono">{(entity.data.sog_knots ?? 0)} kts</span>
          </div>
          <div class="metric-row">
            <span class="label">Course Over Ground</span>
            <span class="value mono">{(entity.data.cog_deg ?? 0)}°</span>
          </div>
          <div class="metric-row">
            <span class="label">Heading</span>
            <span class="value mono">{entity.data.heading_deg ?? 511}°</span>
          </div>
          {#if entity.data.destination}
            <div class="metric-row full-width">
              <span class="label">Destination</span>
              <span class="value mono">{entity.data.destination}</span>
            </div>
          {/if}
        </div>
      {:else if entity.kind === 'quake'}
        <div class="telemetry-grid">
          <div class="metric-row">
            <span class="label">Magnitude</span>
            <span class="value mono highlight-amber">M{Number(entity.data.mag ?? 0).toFixed(1)}</span>
          </div>
          <div class="metric-row">
            <span class="label">Hypocentral Depth</span>
            <span class="value mono">{entity.data.depth_km ?? 10} km</span>
          </div>
          <div class="metric-row">
            <span class="label">Significance</span>
            <span class="value mono">{entity.data.significance ?? 0}</span>
          </div>
          <div class="metric-row">
            <span class="label">Alert Level</span>
            <span class="value mono">{entity.data.alert ?? 'None'}</span>
          </div>
          <div class="metric-row full-width">
            <span class="label">Location</span>
            <span class="value">{entity.data.place ?? 'Unknown'}</span>
          </div>
        </div>
      {:else if entity.kind === 'firms'}
        <div class="telemetry-grid">
          <div class="metric-row">
            <span class="label">Fire Power (FRP)</span>
            <span class="value mono highlight-rose">{Number(entity.data.frp_mw ?? 0).toFixed(1)} MW</span>
          </div>
          <div class="metric-row">
            <span class="label">Brightness Temp</span>
            <span class="value mono">{entity.data.brightness_kelvin ?? 0} K</span>
          </div>
          <div class="metric-row">
            <span class="label">Sensor / Satellite</span>
            <span class="value mono">{entity.data.satellite ?? 'VIIRS'}</span>
          </div>
          <div class="metric-row">
            <span class="label">Confidence</span>
            <span class="value mono">{entity.data.confidence ?? 'nominal'}</span>
          </div>
          <div class="metric-row">
            <span class="label">Acquisition UTC</span>
            <span class="value mono">{entity.data.acq_date} {entity.data.acq_time}</span>
          </div>
          <div class="metric-row">
            <span class="label">Day / Night</span>
            <span class="value mono">{entity.data.daynight === 'D' ? 'Day' : 'Night'}</span>
          </div>
        </div>
      {:else if entity.kind === 'gbfs'}
        <div class="telemetry-grid">
          <div class="metric-row">
            <span class="label">Available Bikes</span>
            <span class="value mono highlight-indigo">{entity.data.num_bikes_available ?? 0}</span>
          </div>
          <div class="metric-row">
            <span class="label">Available Docks</span>
            <span class="value mono">{entity.data.num_docks_available ?? 0}</span>
          </div>
          <div class="metric-row">
            <span class="label">Total Capacity</span>
            <span class="value mono">{entity.data.capacity ?? 0}</span>
          </div>
          <div class="metric-row">
            <span class="label">Rental Status</span>
            <span class="value mono">{entity.data.is_renting ? 'Active' : 'Offline'}</span>
          </div>
          <div class="metric-row full-width">
            <span class="label">Station Name</span>
            <span class="value">{entity.data.name}</span>
          </div>
        </div>
      {:else if entity.kind === 'cctv'}
        <div class="telemetry-grid">
          <div class="media-container full-width">
            <img
              src={`/api/cctv/snapshot/${entity.data.id ?? entity.id}`}
              alt={String(entity.name)}
              class="cctv-preview-img"
              onerror={(e) => {
                // Fallback placeholder if snapshot is unreachable
                const target = e.currentTarget as HTMLImageElement;
                target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="180" viewBox="0 0 300 180"><rect width="300" height="180" fill="%230f172a"/><text x="50%" y="50%" fill="%23a855f7" font-family="monospace" font-size="12" text-anchor="middle" dominant-baseline="middle">LIVE SNAPSHOT PENDING</text></svg>';
              }}
            />
          </div>
          <div class="metric-row">
            <span class="label">Managing Agency</span>
            <span class="value mono highlight-purple">{entity.data.agency ?? 'DOT'}</span>
          </div>
          <div class="metric-row">
            <span class="label">Format / Stream</span>
            <span class="value mono">{entity.data.stream_type ?? 'image'}</span>
          </div>
          <div class="metric-row">
            <span class="label">Refresh Cadence</span>
            <span class="value mono">{entity.data.refresh_interval_sec ?? 10}s</span>
          </div>
          <div class="metric-row">
            <span class="label">Status</span>
            <span class="value mono">{entity.data.status ?? 'online'}</span>
          </div>
        </div>
      {:else if entity.kind === 'radio'}
        <div class="telemetry-grid">
          <div class="media-container full-width radio-player-container">
            <audio
              bind:this={audioPlayer}
              controls
              src={`/api/radio/stream/${entity.data.id ?? entity.id}`}
              class="tactical-audio-player"
            ></audio>
          </div>
          <div class="metric-row">
            <span class="label">Genre / Category</span>
            <span class="value mono highlight-cyan">{String(entity.data.category ?? 'atc').toUpperCase()}</span>
          </div>
          {#if entity.data.frequency_mhz}
            <div class="metric-row">
              <span class="label">Frequency</span>
              <span class="value mono">{entity.data.frequency_mhz} MHz</span>
            </div>
          {/if}
          <div class="metric-row">
            <span class="label">Bitrate</span>
            <span class="value mono">{entity.data.bitrate_kbps ?? 64} kbps</span>
          </div>
          <div class="metric-row">
            <span class="label">Location</span>
            <span class="value">{entity.data.location_name ?? 'Radio Tower'}</span>
          </div>
        </div>
      {:else if entity.kind === 'launch'}
        <div class="telemetry-grid">
          <div class="metric-row">
            <span class="label">Launch Provider</span>
            <span class="value mono highlight-gold">{entity.data.provider ?? 'Space Agency'}</span>
          </div>
          <div class="metric-row">
            <span class="label">Launch Vehicle</span>
            <span class="value mono">{entity.data.vehicle ?? 'Orbital Rocket'}</span>
          </div>
          <div class="metric-row">
            <span class="label">Target Orbit</span>
            <span class="value mono">{entity.data.target_orbit ?? 'LEO'}</span>
          </div>
          <div class="metric-row">
            <span class="label">Apogee / Perigee</span>
            <span class="value mono">{entity.data.apogee_km}km / {entity.data.perigee_km}km</span>
          </div>
          <div class="metric-row full-width">
            <span class="label">Launch Complex</span>
            <span class="value">{entity.data.launch_site ?? 'Launch Site'}</span>
          </div>
          <div class="metric-row full-width">
            <span class="label">Trajectory Provenance</span>
            <span class="value mono simulation-badge">
              {entity.data.is_simulated ? '[SIMULATED ORBITAL MODEL]' : '[RECONSTRUCTED TELEMETRY]'}
            </span>
          </div>
        </div>

        {#if Array.isArray(entity.data.trajectory) && entity.data.trajectory.length > 0}
          <TelemetryTimelineChart
            title="Ascent Trajectory & Velocity Profile"
            xAxisLabel="Time (s)"
            data={getLaunchTimeSeries(entity.data.trajectory as Array<{ time_offset_sec: number; altitude_m: number; velocity_ms: number }>)}
            seriesConfigs={[
              { label: 'Alt (km)', stroke: WEB_CHANNEL_COLORS.launch, valueFormat: (v) => `${v.toFixed(1)}km` },
              { label: 'Velocity (m/s)', stroke: WEB_CHANNEL_COLORS.flight, valueFormat: (v) => `${v.toFixed(0)}m/s` },
            ]}
            height={130}
          />
        {/if}
      {:else if entity.kind === 'satellite'}
        <SatelliteEntityDetails data={entity.data} />
      {:else if entity.kind === 'weather'}
        <div class="telemetry-grid">
          <div class="metric-row">
            <span class="label">Temperature</span>
            <span class="value mono highlight-blue">{entity.data.temp_c ?? 0}°C</span>
          </div>
          <div class="metric-row">
            <span class="label">Conditions</span>
            <span class="value mono">{entity.data.condition ?? 'Clear'}</span>
          </div>
          <div class="metric-row">
            <span class="label">Relative Humidity</span>
            <span class="value mono">{entity.data.humidity_pct ?? 0}%</span>
          </div>
          <div class="metric-row">
            <span class="label">Wind Vector</span>
            <span class="value mono">{entity.data.wind_speed_kmh ?? 0} km/h @ {entity.data.wind_direction_deg ?? 0}°</span>
          </div>
          <div class="metric-row full-width">
            <span class="label">Observatory</span>
            <span class="value">{entity.data.name}</span>
          </div>
        </div>

        <TelemetryTimelineChart
          title="Atmospheric History (12h Profile)"
          xAxisLabel="Hours Ago"
          data={getWeatherTimeSeries(entity.data)}
          seriesConfigs={[
            { label: 'Temp (°C)', stroke: WEB_CHANNEL_COLORS.flight, valueFormat: (v) => `${v.toFixed(1)}°C` },
            { label: 'Wind (km/h)', stroke: WEB_CHANNEL_COLORS.marine, valueFormat: (v) => `${v.toFixed(1)}km/h` },
          ]}
          height={120}
        />
      {/if}
    </div>
  </section>
{/if}

<style>
  .entity-card {
    position: absolute;
    bottom: 36px;
    right: 16px;
    width: 320px;
    background: var(--hud-panel-bg-raised);
    backdrop-filter: blur(14px);
    border: 1px solid var(--hud-border);
    border-radius: 10px;
    padding: 14px;
    pointer-events: auto;
    z-index: 20;
    box-shadow: 0 8px 32px var(--hud-shadow);
  }

  /* Channel Law Border Glows */
  .kind-flight { border-left: 3px solid var(--channel-flight); }
  .kind-marine { border-left: 3px solid var(--channel-marine); }
  .kind-quake { border-left: 3px solid var(--channel-quake); }
  .kind-firms { border-left: 3px solid var(--channel-firms); }
  .kind-gbfs { border-left: 3px solid var(--channel-gbfs); }
  .kind-cctv { border-left: 3px solid var(--channel-cctv); }
  .kind-radio { border-left: 3px solid var(--channel-radio); }
  .kind-launch { border-left: 3px solid var(--channel-launch); }
  .kind-weather { border-left: 3px solid var(--channel-weather); }
  .kind-satellite { border-left: 3px solid var(--channel-satellites); }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--hud-border-muted);
    padding-bottom: 8px;
  }

  .header-main {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .kind-badge {
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    padding: 1px 6px;
    border-radius: 3px;
    width: fit-content;
  }

  .kind-flight .kind-badge { background: var(--channel-flight-soft); color: var(--channel-flight); }
  .kind-marine .kind-badge { background: var(--channel-marine-soft); color: var(--channel-marine); }
  .kind-quake .kind-badge { background: var(--channel-quake-soft); color: var(--channel-quake); }
  .kind-firms .kind-badge { background: var(--channel-firms-soft); color: var(--channel-firms); }
  .kind-gbfs .kind-badge { background: var(--channel-gbfs-soft); color: var(--channel-gbfs); }
  .kind-cctv .kind-badge { background: var(--channel-cctv-soft); color: var(--channel-cctv); }
  .kind-radio .kind-badge { background: var(--channel-radio-soft); color: var(--channel-radio); }
  .kind-launch .kind-badge { background: var(--channel-launch-soft); color: var(--channel-launch); }
  .kind-weather .kind-badge { background: var(--channel-weather-soft); color: var(--channel-weather); }
  .kind-satellite .kind-badge { background: var(--channel-satellites-soft); color: var(--channel-satellites); }

  .entity-title {
    margin: 0;
    font-size: 0.92rem;
    font-weight: 700;
    color: var(--hud-text-primary);
  }

  .close-btn {
    background: transparent;
    border: none;
    color: var(--hud-text-secondary);
    cursor: pointer;
    font-size: 0.85rem;
    padding: 2px 4px;
  }

  .telemetry-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .media-container {
    border-radius: 6px;
    overflow: hidden;
    background: var(--hud-surface-dark);
    border: 1px solid var(--hud-chip-border);
  }

  .cctv-preview-img {
    width: 100%;
    height: 160px;
    object-fit: cover;
    display: block;
  }

  .radio-player-container {
    padding: 6px;
    background: var(--hud-panel-bg-soft);
  }

  .tactical-audio-player {
    width: 100%;
    height: 32px;
  }

  .metric-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .metric-row.full-width {
    grid-column: span 2;
  }

  .label {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--hud-text-secondary);
  }

  .value {
    font-size: 0.82rem;
    color: var(--hud-text-data);
  }

  .value.mono {
    font-family: ui-monospace, 'JetBrains Mono', monospace;
    font-variant-numeric: tabular-nums;
  }

  .highlight-teal { color: var(--channel-marine); font-weight: 600; }
  .highlight-amber { color: var(--channel-quake); font-weight: 600; }
  .highlight-rose { color: var(--channel-firms); font-weight: 600; }
  .highlight-indigo { color: var(--channel-gbfs); font-weight: 600; }
  .highlight-purple { color: var(--channel-cctv); font-weight: 600; }
  .highlight-cyan { color: var(--channel-radio); font-weight: 600; }
  .highlight-gold { color: var(--channel-launch); font-weight: 600; }
  .highlight-blue { color: var(--channel-weather); font-weight: 600; }

  .simulation-badge {
    font-size: 0.70rem;
    color: var(--hud-warning);
    font-weight: 600;
  }
</style>
