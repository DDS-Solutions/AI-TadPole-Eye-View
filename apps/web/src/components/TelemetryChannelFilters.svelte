<script lang="ts">
  import { layerStore } from '../stores/layers.svelte.js';

  const channels = [
    { value: 'all', label: 'ALL', className: '' },
    { value: 'flight', label: 'ADS-B', className: 'btn-flight' },
    { value: 'marine', label: 'AIS', className: 'btn-marine' },
    { value: 'quake', label: 'USGS', className: 'btn-quake' },
    { value: 'firms', label: 'FIRMS', className: 'btn-firms' },
    { value: 'gbfs', label: 'GBFS', className: 'btn-gbfs' },
    { value: 'cctv', label: 'CCTV', className: 'btn-cctv' },
    { value: 'radio', label: 'RADIO', className: 'btn-radio' },
    { value: 'launch', label: 'LAUNCH', className: 'btn-launch' },
    { value: 'weather', label: 'WX', className: 'btn-weather' },
    { value: 'satellite', label: 'ORBIT', className: 'btn-satellite' },
  ] as const;
</script>

<div class="channel-filter-group" aria-label="Telemetry channel filters">
  {#each channels as channel}
    <button
      id={channel.value === 'satellite' ? 'filter-satellites' : undefined}
      class="channel-btn {channel.className}"
      class:active={layerStore.tableChannel === channel.value}
      onclick={() => (layerStore.tableChannel = channel.value)}
    >
      {channel.label}
    </button>
  {/each}
</div>

<style>
  .channel-filter-group {
    display: flex;
    gap: 4px;
    align-items: center;
    flex-wrap: wrap;
  }

  .channel-btn {
    --filter-accent: var(--hud-accent);
    background: var(--hud-chip-bg);
    border: 1px solid var(--hud-chip-border);
    color: var(--hud-text-secondary);
    font-size: 0.65rem;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .channel-btn:hover {
    background: var(--hud-row-bg);
    color: var(--hud-text-primary);
  }

  .channel-btn.active {
    background: var(--filter-accent);
    color: var(--hud-panel-bg-strong);
    border-color: var(--filter-accent);
    font-weight: 700;
  }

  .btn-flight { --filter-accent: var(--channel-flight); }
  .btn-marine { --filter-accent: var(--channel-marine); }
  .btn-quake { --filter-accent: var(--channel-quake); }
  .btn-firms { --filter-accent: var(--channel-firms); }
  .btn-gbfs { --filter-accent: var(--channel-gbfs); }
  .btn-cctv { --filter-accent: var(--channel-cctv); }
  .btn-radio { --filter-accent: var(--channel-radio); }
  .btn-launch { --filter-accent: var(--channel-launch); }
  .btn-weather { --filter-accent: var(--channel-weather); }
  .btn-satellite { --filter-accent: var(--channel-satellites); }
</style>
