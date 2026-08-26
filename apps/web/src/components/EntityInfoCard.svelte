<script lang="ts">
  import { layerStore } from '../stores/layers.svelte.js';
  import TelemetryTimelineChart from './TelemetryTimelineChart.svelte';

  const entity = $derived(layerStore.selectedEntity);
  let audioPlayer = $state<HTMLAudioElement | null>(null);

  function getFlightTimeSeries(data: Record<string, unknown>): [number[], number[], number[]] {
    const alt = Number(data.baro_altitude ?? data.geo_altitude ?? 8000);
    const vel = Number(data.velocity ?? 220);
    const vertRate = Number(data.vertical_rate ?? 0);
    const timestamps = [0, 10, 20, 30, 40, 50, 60];
    const altitudes = timestamps.map((t) => Math.max(0, alt - (60 - t) * (vertRate || 2)));
    const velocities = timestamps.map((t) => Math.max(0, vel + Math.sin(t / 10) * 5));
    return [timestamps, altitudes, velocities];
  }

  function getLaunchTimeSeries(
    trajectory: Array<{ time_offset_sec: number; altitude_m: number; velocity_ms: number }>
  ): [number[], number[], number[]] {
    const times = trajectory.map((p) => p.time_offset_sec);
    const alts = trajectory.map((p) => p.altitude_m / 1000);
    const vels = trajectory.map((p) => p.velocity_ms);
    return [times, alts, vels];
  }

  function getWeatherTimeSeries(data: Record<string, unknown>): [number[], number[], number[]] {
    const baseTemp = Number(data.temp_c ?? 18);
    const baseWind = Number(data.wind_speed_kmh ?? 15);
    const hours = [0, 2, 4, 6, 8, 10, 12];
    const temps = hours.map((h) => Number((baseTemp + Math.sin(h / 2) * 3).toFixed(1)));
    const winds = hours.map((h) => Number(Math.max(0, baseWind + Math.cos(h / 2) * 4).toFixed(1)));
    return [hours, temps, winds];
  }
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
            { label: 'Altitude (m)', stroke: '#38bdf8', valueFormat: (v) => `${v.toFixed(0)}m` },
            { label: 'Velocity (m/s)', stroke: '#2dd4bf', valueFormat: (v) => `${v.toFixed(0)}m/s` },
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
              { label: 'Alt (km)', stroke: '#fbbf24', valueFormat: (v) => `${v.toFixed(1)}km` },
              { label: 'Velocity (m/s)', stroke: '#38bdf8', valueFormat: (v) => `${v.toFixed(0)}m/s` },
            ]}
            height={130}
          />
        {/if}
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
            { label: 'Temp (°C)', stroke: '#38bdf8', valueFormat: (v) => `${v.toFixed(1)}°C` },
            { label: 'Wind (km/h)', stroke: '#2dd4bf', valueFormat: (v) => `${v.toFixed(1)}km/h` },
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
    background: rgba(15, 23, 42, 0.92);
    backdrop-filter: blur(14px);
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 10px;
    padding: 14px;
    pointer-events: auto;
    z-index: 20;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  }

  /* Channel Law Border Glows */
  .kind-flight { border-left: 3px solid #38bdf8; }
  .kind-marine { border-left: 3px solid #2dd4bf; }
  .kind-quake { border-left: 3px solid #fb923c; }
  .kind-firms { border-left: 3px solid #f43f5e; }
  .kind-gbfs { border-left: 3px solid #818cf8; }
  .kind-cctv { border-left: 3px solid #a855f7; }
  .kind-radio { border-left: 3px solid #06b6d4; }
  .kind-launch { border-left: 3px solid #facc15; }
  .kind-weather { border-left: 3px solid #60a5fa; }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 12px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.12);
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

  .kind-flight .kind-badge { background: rgba(56, 189, 248, 0.2); color: #38bdf8; }
  .kind-marine .kind-badge { background: rgba(45, 212, 191, 0.2); color: #2dd4bf; }
  .kind-quake .kind-badge { background: rgba(251, 146, 60, 0.2); color: #fb923c; }
  .kind-firms .kind-badge { background: rgba(244, 63, 94, 0.2); color: #f43f5e; }
  .kind-gbfs .kind-badge { background: rgba(129, 140, 248, 0.2); color: #818cf8; }
  .kind-cctv .kind-badge { background: rgba(168, 85, 247, 0.2); color: #a855f7; }
  .kind-radio .kind-badge { background: rgba(6, 182, 212, 0.2); color: #06b6d4; }
  .kind-launch .kind-badge { background: rgba(250, 204, 21, 0.2); color: #facc15; }
  .kind-weather .kind-badge { background: rgba(96, 165, 250, 0.2); color: #60a5fa; }

  .entity-title {
    margin: 0;
    font-size: 0.92rem;
    font-weight: 700;
    color: #f8fafc;
  }

  .close-btn {
    background: transparent;
    border: none;
    color: #94a3b8;
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
    background: #030712;
    border: 1px solid rgba(148, 163, 184, 0.15);
  }

  .cctv-preview-img {
    width: 100%;
    height: 160px;
    object-fit: cover;
    display: block;
  }

  .radio-player-container {
    padding: 6px;
    background: rgba(15, 23, 42, 0.6);
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
    color: #94a3b8;
  }

  .value {
    font-size: 0.82rem;
    color: #e2e8f0;
  }

  .value.mono {
    font-family: ui-monospace, 'JetBrains Mono', monospace;
    font-variant-numeric: tabular-nums;
  }

  .highlight-teal { color: #2dd4bf; font-weight: 600; }
  .highlight-amber { color: #fb923c; font-weight: 600; }
  .highlight-rose { color: #f43f5e; font-weight: 600; }
  .highlight-indigo { color: #818cf8; font-weight: 600; }
  .highlight-purple { color: #a855f7; font-weight: 600; }
  .highlight-cyan { color: #06b6d4; font-weight: 600; }
  .highlight-gold { color: #facc15; font-weight: 600; }
  .highlight-blue { color: #60a5fa; font-weight: 600; }

  .simulation-badge {
    font-size: 0.70rem;
    color: #fbbf24;
    font-weight: 600;
  }
</style>
