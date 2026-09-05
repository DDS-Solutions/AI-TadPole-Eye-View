<script lang="ts">
  import { layerStore } from '../stores/layers.svelte.js';
</script>

<div
  id="satellite-layer-row"
  class="satellite-row"
  class:locked={layerStore.satelliteAccessLock !== null}
  title={layerStore.satelliteAccessLock ?? 'Derived satellite estimates'}
>
  <div class="layer-info">
    <span class="layer-indicator"></span>
    <div class="layer-text">
      <span class="layer-name">Satellite Estimates</span>
      {#if layerStore.satelliteAccessLock}
        <span id="satellite-access-lock" class="layer-sub lock-reason">
          {layerStore.satelliteAccessLockCode === 'PROVIDER_DISABLED'
            ? 'Disabled by platform administrator'
            : 'Production locked · terms approval required'}
        </span>
      {:else}
        <span class="layer-sub">
          {layerStore.provenance.satellites?.source.name ?? 'Awaiting validated source'} ·
          <span id="satellite-count" class="mono">{layerStore.counts.satellites}</span>
        </span>
      {/if}
    </div>
  </div>
  <label class="switch">
    <input
      id="toggle-satellites"
      type="checkbox"
      checked={layerStore.visibility.satellites}
      disabled={layerStore.satelliteAccessLock !== null}
      aria-describedby={layerStore.satelliteAccessLock ? 'satellite-access-lock' : undefined}
      onchange={() => layerStore.toggleLayer('satellites')}
    />
    <span class="slider"></span>
  </label>
</div>

<style>
  .satellite-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 5px 8px;
    border-radius: 6px;
    background: var(--hud-row-bg);
    border: 1px solid var(--hud-border-faint);
  }

  .satellite-row.locked { opacity: 0.58; }
  .layer-info { display: flex; align-items: center; gap: 8px; }
  .layer-indicator {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: var(--channel-satellites);
  }
  .layer-text { display: flex; flex-direction: column; }
  .layer-name { font-size: 0.76rem; font-weight: 600; color: var(--hud-text-panel); }
  .layer-sub { font-size: 0.63rem; color: var(--hud-text-secondary); }
  .lock-reason { color: var(--hud-warning); }
  .mono { font-family: ui-monospace, monospace; }

  .switch { position: relative; display: inline-block; width: 34px; height: 18px; }
  .switch input {
    position: absolute;
    inset: 0;
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
    inset: 0;
    background-color: var(--hud-switch-off);
    border-radius: 18px;
    transition: 0.2s;
  }
  .slider:before {
    position: absolute;
    content: '';
    height: 12px;
    width: 12px;
    left: 3px;
    bottom: 3px;
    background-color: var(--hud-switch-knob);
    border-radius: 50%;
    transition: 0.2s;
  }
  input:checked + .slider { background-color: var(--channel-satellites); }
  input:checked + .slider:before { transform: translateX(16px); }
  input:disabled,
  input:disabled + .slider { cursor: not-allowed; }
</style>
