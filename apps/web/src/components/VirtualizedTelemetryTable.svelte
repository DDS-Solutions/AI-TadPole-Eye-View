<script lang="ts">
  import { WEB_CHANNEL_COLORS } from '../designTokens.js';
  import { layerStore, type UnifiedTelemetryItem } from '../stores/layers.svelte.js';
  import TelemetryChannelFilters from './TelemetryChannelFilters.svelte';

  let scrollContainer: HTMLDivElement | null = $state(null);
  let scrollTop = $state(0);
  let viewportHeight = $state(280);
  let wasTableOpen = false;
  let previousFilterKey = '';

  const rowHeight = 36;
  const overscan = 6;

  const items = $derived(layerStore.filteredItems);
  const totalItems = $derived(items.length);
  const totalHeight = $derived(totalItems * rowHeight);
  const startIndex = $derived(
    Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  );
  const endIndex = $derived(
    Math.min(totalItems, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan)
  );
  const visibleItems = $derived(items.slice(startIndex, endIndex));
  $effect(() => {
    const isOpen = layerStore.isTableOpen;
    const filterKey = `${layerStore.tableChannel}\u0000${layerStore.tableQuery}`;
    const shouldResetScroll = isOpen && (!wasTableOpen || filterKey !== previousFilterKey);

    if (shouldResetScroll) {
      scrollTop = 0;
      if (scrollContainer) {
        scrollContainer.scrollTop = 0;
      }
    }

    wasTableOpen = isOpen;
    previousFilterKey = filterKey;
  });

  function handleScroll(e: Event) {
    const target = e.currentTarget as HTMLDivElement;
    scrollTop = target.scrollTop;
  }

  function handleSelectRow(item: UnifiedTelemetryItem) {
    layerStore.selectEntity({
      kind: item.kind,
      id: item.id,
      name: item.name,
      data: item.rawData,
    });
    layerStore.triggerFlyTo(item.lat, item.lon, item.alt);
  }

  function handleCloseTable() {
    layerStore.toggleTable(false);
    queueMicrotask(() => document.getElementById('toggle-telemetry-table-btn')?.focus());
  }

  function getKindColor(kind: string): string {
    switch (kind) {
      case 'flight':
        return WEB_CHANNEL_COLORS.flight;
      case 'marine':
        return WEB_CHANNEL_COLORS.marine;
      case 'quake':
        return WEB_CHANNEL_COLORS.quake;
      case 'firms':
        return WEB_CHANNEL_COLORS.firms;
      case 'gbfs':
        return WEB_CHANNEL_COLORS.gbfs;
      case 'cctv':
        return WEB_CHANNEL_COLORS.cctv;
      case 'radio':
        return WEB_CHANNEL_COLORS.radio;
      case 'launch':
        return WEB_CHANNEL_COLORS.launch;
      case 'weather':
        return WEB_CHANNEL_COLORS.weather;
      case 'satellite':
        return WEB_CHANNEL_COLORS.satellite;
      default:
        return WEB_CHANNEL_COLORS.muted;
    }
  }
</script>

{#if layerStore.isTableOpen}
  <section
    id="virtualized-telemetry-table"
    class="telemetry-table-panel"
    aria-labelledby="telemetry-table-title"
  >
    <div class="table-header">
      <div class="header-title-group">
        <span class="pulse-icon" aria-hidden="true">●</span>
        <h3 id="telemetry-table-title" class="table-title">High-Density Telemetry Stream</h3>
        <span class="count-badge mono" data-testid="telemetry-count" aria-live="polite">
          {totalItems.toLocaleString()} ENTITIES
        </span>
      </div>

      <TelemetryChannelFilters />

      <div class="search-actions">
        <div class="search-box">
          <span class="search-icon" aria-hidden="true">🔍</span>
          <input
            id="telemetry-search-input"
            type="text"
            placeholder="Search callsign, MMSI, location..."
            aria-label="Search telemetry"
            bind:value={layerStore.tableQuery}
          />
          {#if layerStore.tableQuery}
            <button
              type="button"
              class="clear-search-btn"
              aria-label="Clear telemetry search"
              onclick={() => (layerStore.tableQuery = '')}
            >✕</button>
          {/if}
        </div>
        <button
          type="button"
          id="close-table-btn"
          class="close-table-btn"
          onclick={handleCloseTable}
          aria-label="Close telemetry table"
          title="Close table"
        >
          ✕
        </button>
      </div>
    </div>

    <div class="columns-header">
      <div class="col col-kind">DOMAIN</div>
      <div class="col col-id">CALLSIGN / NAME</div>
      <div class="col col-metric1">PRIMARY METRIC</div>
      <div class="col col-metric2">SECONDARY METRIC</div>
      <div class="col col-coords">COORDINATES</div>
      <div class="col col-time">STATUS / TIME</div>
      <div class="col col-action">ACTION</div>
    </div>

    <div
      bind:this={scrollContainer}
      class="virtual-viewport"
      onscroll={handleScroll}
      style="height: {viewportHeight}px;"
      role="region"
      aria-label="Telemetry rows"
    >
      <div class="virtual-scroll-track" style="height: {totalHeight}px;">
        {#each visibleItems as item, visibleIndex (item.kind + '-' + item.id)}
          {@const virtualIndex = startIndex + visibleIndex}
          <button
            type="button"
            class="virtual-row"
            class:selected={
              layerStore.selectedEntity?.kind === item.kind &&
              layerStore.selectedEntity.id === item.id
            }
            style="transform: translateY({virtualIndex * rowHeight}px); height: {rowHeight}px;"
            onclick={() => handleSelectRow(item)}
            aria-label={`Focus ${item.kind} ${item.name}`}
            data-virtual-index={virtualIndex}
            data-entity-kind={item.kind}
            data-entity-id={item.id}
          >
            <span class="col col-kind">
              <span
                class="kind-badge"
                style="background: {getKindColor(item.kind)}20; color: {getKindColor(item.kind)}; border-color: {getKindColor(item.kind)}50;"
              >
                {item.kind.toUpperCase()}
              </span>
            </span>
            <span class="col col-id mono font-semibold" title={item.name}>
              {item.name}
            </span>
            <span class="col col-metric1 mono text-slate-300">
              {item.metric1}
            </span>
            <span class="col col-metric2 mono text-slate-400">
              {item.metric2}
            </span>
            <span class="col col-coords mono text-slate-400 text-xs">
              {item.coordinates}
            </span>
            <span class="col col-time mono text-slate-400 text-xs">
              {item.timeText}
            </span>
            <span class="col col-action">
              <span class="focus-btn" aria-hidden="true">🎯 Focus</span>
            </span>
          </button>
        {/each}
        {#if totalItems === 0}
          <div class="empty-state" role="status">
            No telemetry records matching filter criteria.
          </div>
        {/if}
      </div>
    </div>
  </section>
{/if}

<style>
  .telemetry-table-panel {
    position: absolute;
    bottom: 36px;
    left: 16px;
    right: 16px;
    background: var(--hud-panel-bg-overlay);
    backdrop-filter: blur(16px);
    border: 1px solid var(--hud-border-strong);
    border-radius: 8px;
    box-shadow: 0 12px 36px var(--hud-shadow), 0 0 16px var(--hud-accent-soft);
    z-index: 40;
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: var(--hud-text-primary);
  }
  .table-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 14px;
    background: var(--hud-surface-dark-soft);
    border-bottom: 1px solid var(--hud-chip-border);
    gap: 12px;
    flex-wrap: wrap;
  }
  .header-title-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .pulse-icon {
    color: var(--hud-success-signal);
    font-size: 0.7rem;
    animation: pulse 2s infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .table-title {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--hud-text-primary);
  }
  .count-badge {
    font-size: 0.68rem;
    background: var(--hud-accent-soft);
    color: var(--hud-accent);
    border: 1px solid var(--hud-accent-border);
    padding: 2px 6px;
    border-radius: 4px;
  }
  .search-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .search-box {
    display: flex;
    align-items: center;
    background: var(--hud-panel-bg-muted);
    border: 1px solid var(--hud-border-prominent);
    border-radius: 4px;
    padding: 2px 8px;
    gap: 6px;
  }
  .search-icon {
    font-size: 0.75rem;
    color: var(--hud-text-dim);
  }
  .search-box input {
    background: transparent;
    border: none;
    outline: none;
    color: var(--hud-text-primary);
    font-size: 0.75rem;
    font-family: inherit;
    width: 180px;
  }
  .search-box input::placeholder {
    color: var(--hud-text-dim);
  }
  .clear-search-btn {
    background: none;
    border: none;
    color: var(--hud-text-secondary);
    cursor: pointer;
    font-size: 0.7rem;
    padding: 0;
  }
  .close-table-btn {
    background: var(--hud-chip-bg-strong);
    border: 1px solid var(--hud-border-medium);
    color: var(--hud-text-secondary);
    width: 24px;
    height: 24px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .close-table-btn:hover {
    color: var(--hud-text-primary);
    background: var(--hud-danger-soft);
    border-color: var(--hud-danger);
  }

  .columns-header {
    display: grid;
    grid-template-columns: 80px 1.5fr 1.2fr 1.2fr 1.2fr 100px 90px;
    padding: 6px 12px;
    background: var(--hud-surface-dark-strong);
    border-bottom: 1px solid var(--hud-chip-border);
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--hud-text-secondary);
    letter-spacing: 0.05em;
  }

  .virtual-viewport {
    position: relative;
    overflow-y: auto;
    overflow-x: hidden;
    width: 100%;
  }

  .virtual-viewport::-webkit-scrollbar {
    width: 6px;
  }

  .virtual-viewport::-webkit-scrollbar-track {
    background: var(--hud-surface-dark-faint);
  }

  .virtual-viewport::-webkit-scrollbar-thumb {
    background: var(--hud-border-solid-soft);
    border-radius: 3px;
  }

  .virtual-scroll-track {
    position: relative;
    width: 100%;
  }

  .virtual-row {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    display: grid;
    grid-template-columns: 80px 1.5fr 1.2fr 1.2fr 1.2fr 100px 90px;
    align-items: center;
    padding: 0 12px;
    box-sizing: border-box;
    border-bottom: 1px solid var(--hud-border-faint);
    font-size: 0.75rem;
    font-family: inherit;
    color: inherit;
    text-align: left;
    appearance: none;
    background: transparent;
    cursor: pointer;
    transition: background 0.1s ease;
  }

  .virtual-row:hover {
    background: var(--hud-accent-faint);
  }

  .virtual-row:focus-visible {
    outline: 2px solid var(--hud-accent);
    outline-offset: -2px;
    background: var(--hud-accent-faint);
  }

  .virtual-row.selected {
    background: var(--hud-accent-row-selected);
    border-left: 3px solid var(--hud-accent);
  }

  .col {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-right: 8px;
  }

  .kind-badge {
    font-size: 0.62rem;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 3px;
    border: 1px solid transparent;
    display: inline-block;
  }

  .mono {
    font-family: ui-monospace, monospace;
  }

  .focus-btn {
    background: var(--hud-accent-soft);
    border: 1px solid var(--hud-accent-border);
    color: var(--hud-accent);
    font-size: 0.65rem;
    font-family: ui-monospace, monospace;
    padding: 2px 6px;
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .virtual-row:hover .focus-btn,
  .virtual-row:focus-visible .focus-btn {
    background: var(--hud-accent);
    color: var(--hud-surface-dark);
  }

  .empty-state {
    padding: 32px;
    text-align: center;
    color: var(--hud-text-secondary);
    font-size: 0.8rem;
  }

  @media (max-width: 720px) {
    .telemetry-table-panel {
      right: 4px;
      bottom: 36px;
      left: 4px;
    }

    .table-header {
      gap: 8px;
      padding: 8px;
    }

    .header-title-group,
    .search-actions {
      width: 100%;
      min-width: 0;
    }

    .count-badge {
      margin-left: auto;
      white-space: nowrap;
    }

    .search-box {
      flex: 1;
      min-width: 0;
    }

    .search-box input {
      width: 100%;
      min-width: 0;
    }

    .columns-header,
    .virtual-row {
      grid-template-columns: 60px minmax(0, 1fr) minmax(72px, 0.8fr) 64px;
      padding-right: 6px;
      padding-left: 6px;
    }

    .col-metric2,
    .col-coords,
    .col-time {
      display: none;
    }

    .focus-btn {
      padding-right: 4px;
      padding-left: 4px;
    }
  }
</style>
