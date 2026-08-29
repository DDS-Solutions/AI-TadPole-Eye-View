<script lang="ts">
  import { layerStore } from '../stores/layers.svelte.js';
</script>

<div id="provenance-badges" class="provenance-badges" title={layerStore.provenanceSummary.details}>
  <span id="provenance-source-badge" class="badge">
    {layerStore.provenanceSummary.sourceLabel}
  </span>
  <span id="provenance-mode-badge" class="badge">
    {layerStore.provenanceSummary.modeLabel}
  </span>
  <span
    id="provenance-freshness-badge"
    class="badge freshness"
    class:healthy={layerStore.provenanceSummary.freshnessLabel === 'FRESH'}
  >
    {layerStore.provenanceSummary.freshnessLabel}
  </span>
</div>

<style>
  .provenance-badges {
    margin-top: 10px;
    padding-top: 6px;
    border-top: 1px solid var(--hud-divider);
    display: flex;
    gap: 4px;
    align-items: center;
    font-family: ui-monospace, monospace;
  }

  .badge {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--hud-text-secondary);
    background: var(--hud-row-bg);
    padding: 2px 4px;
    border-radius: 3px;
  }

  .freshness {
    margin-left: auto;
  }

  .healthy {
    color: var(--hud-success);
    background: var(--hud-success-soft);
  }
</style>
