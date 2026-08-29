<script lang="ts">
  import { layerStore } from '../stores/layers.svelte.js';
</script>

<div class="filters-container">
  <div class="filter-group">
    <div class="filter-group-header">
      <span class="channel-dot quake-dot"></span>
      <span class="filter-title">USGS Earthquake Magnitude</span>
    </div>
    <div class="filter-options-row">
      <button
        class="filter-chip"
        class:active={layerStore.filters.quakes.minMagnitude === 0}
        onclick={() => layerStore.setQuakeMinMagnitude(0)}
      >All (M0+)</button>
      <button
        id="filter-quakes-m25"
        class="filter-chip"
        class:active={layerStore.filters.quakes.minMagnitude === 2.5}
        onclick={() => layerStore.setQuakeMinMagnitude(2.5)}
      >M2.5+</button>
      <button
        id="filter-quakes-m45"
        class="filter-chip"
        class:active={layerStore.filters.quakes.minMagnitude === 4.5}
        onclick={() => layerStore.setQuakeMinMagnitude(4.5)}
      >M4.5+ (Major)</button>
    </div>
  </div>

  <div class="filter-group">
    <div class="filter-group-header">
      <span class="channel-dot firms-dot"></span>
      <span class="filter-title">NASA FIRMS Fire Power (FRP)</span>
    </div>
    <div class="filter-options-row">
      <button
        class="filter-chip"
        class:active={layerStore.filters.firms.minFrp === 0}
        onclick={() => layerStore.setFirmsMinFrp(0)}
      >All</button>
      <button
        id="filter-firms-frp10"
        class="filter-chip"
        class:active={layerStore.filters.firms.minFrp === 10}
        onclick={() => layerStore.setFirmsMinFrp(10)}
      >&gt;10 MW</button>
      <button
        id="filter-firms-frp50"
        class="filter-chip"
        class:active={layerStore.filters.firms.minFrp === 50}
        onclick={() => layerStore.setFirmsMinFrp(50)}
      >&gt;50 MW (Severe)</button>
    </div>
  </div>

  <div class="filter-group">
    <div class="filter-group-header">
      <span class="channel-dot marine-dot"></span>
      <span class="filter-title">Marine Vessel Category</span>
    </div>
    <div class="filter-options-row">
      <button
        class="filter-chip"
        class:active={layerStore.filters.marine.vesselType === 'all'}
        onclick={() => layerStore.setMarineVesselType('all')}
      >All</button>
      <button
        id="filter-marine-cargo"
        class="filter-chip"
        class:active={layerStore.filters.marine.vesselType === 'cargo'}
        onclick={() => layerStore.setMarineVesselType('cargo')}
      >Cargo</button>
      <button
        id="filter-marine-tanker"
        class="filter-chip"
        class:active={layerStore.filters.marine.vesselType === 'tanker'}
        onclick={() => layerStore.setMarineVesselType('tanker')}
      >Tanker</button>
    </div>
  </div>

  <div class="filter-group">
    <div class="filter-group-header">
      <span class="channel-dot cctv-dot"></span>
      <span class="filter-title">CCTV Managing Agency</span>
    </div>
    <div class="filter-options-row">
      <button
        class="filter-chip"
        class:active={layerStore.filters.cctv.agency === 'all'}
        onclick={() => layerStore.setCctvAgency('all')}
      >All Agencies</button>
      <button
        id="filter-cctv-caltrans"
        class="filter-chip"
        class:active={layerStore.filters.cctv.agency === 'caltrans'}
        onclick={() => layerStore.setCctvAgency('caltrans')}
      >Caltrans</button>
      <button
        id="filter-cctv-nycdot"
        class="filter-chip"
        class:active={layerStore.filters.cctv.agency === 'nycdot'}
        onclick={() => layerStore.setCctvAgency('nycdot')}
      >NYCDOT</button>
    </div>
  </div>

  <div class="filter-group">
    <div class="filter-group-header">
      <span class="channel-dot radio-dot"></span>
      <span class="filter-title">Radio Stream Genre</span>
    </div>
    <div class="filter-options-row">
      <button
        class="filter-chip"
        class:active={layerStore.filters.radio.category === 'all'}
        onclick={() => layerStore.setRadioCategory('all')}
      >All</button>
      <button
        id="filter-radio-atc"
        class="filter-chip"
        class:active={layerStore.filters.radio.category === 'atc'}
        onclick={() => layerStore.setRadioCategory('atc')}
      >ATC Tower</button>
      <button
        id="filter-radio-marine"
        class="filter-chip"
        class:active={layerStore.filters.radio.category === 'marine'}
        onclick={() => layerStore.setRadioCategory('marine')}
      >Marine VHF</button>
    </div>
  </div>
</div>

<style>
  .filters-container {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  .filter-group {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .filter-group-header {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .channel-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .quake-dot { background-color: var(--channel-quake); }
  .firms-dot { background-color: var(--channel-firms); }
  .marine-dot { background-color: var(--channel-marine); }
  .cctv-dot { background-color: var(--channel-cctv); }
  .radio-dot { background-color: var(--channel-radio); }

  .filter-title {
    font-size: 0.68rem;
    font-weight: 600;
    color: var(--hud-text-panel);
  }

  .filter-options-row {
    display: flex;
    gap: 4px;
  }

  .filter-chip {
    flex: 1;
    background: var(--hud-chip-bg);
    border: 1px solid var(--hud-chip-border);
    border-radius: 4px;
    color: var(--hud-text-secondary);
    font-size: 0.65rem;
    padding: 3px 5px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .filter-chip.active {
    background: var(--hud-accent-selected);
    border-color: var(--hud-accent);
    color: var(--hud-text-primary);
    font-weight: 600;
  }
</style>
