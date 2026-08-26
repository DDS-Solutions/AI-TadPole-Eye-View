<script lang="ts">
  import { layerStore, type UnifiedTelemetryItem } from '../stores/layers.svelte.js';

  let scrollContainer: HTMLDivElement | null = $state(null);
  let scrollTop = $state(0);
  let viewportHeight = $state(280);

  const rowHeight = 36;
  const overscan = 10;

  const items = $derived(layerStore.filteredItems);
  const totalItems = $derived(items.length);
  const totalHeight = $derived(totalItems * rowHeight);

  const startIndex = $derived(
    Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  );

  const endIndex = $derived(
    Math.min(totalItems, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan)
  );

  const visibleItems = $derived(
    items.slice(startIndex, endIndex).map((item, i) => ({
      item,
      virtualIndex: startIndex + i,
      offsetY: (startIndex + i) * rowHeight,
    }))
  );

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

  function getKindColor(kind: string): string {
    switch (kind) {
      case 'flight':
        return '#38bdf8';
      case 'marine':
        return '#2dd4bf';
      case 'quake':
        return '#fb923c';
      case 'firms':
        return '#f43f5e';
      case 'gbfs':
        return '#818cf8';
      case 'cctv':
        return '#c084fc';
      case 'radio':
        return '#38bdf8';
      case 'launch':
        return '#fbbf24';
      case 'weather':
        return '#60a5fa';
      default:
        return '#94a3b8';
    }
  }
</script>

{#if layerStore.isTableOpen}
  <section id="virtualized-telemetry-table" class="telemetry-table-panel">
    <!-- Header Controls -->
    <div class="table-header">
      <div class="header-title-group">
        <span class="pulse-icon">●</span>
        <h3 class="table-title">High-Density Telemetry Stream</h3>
        <span class="count-badge mono">{totalItems.toLocaleString()} ENTITIES</span>
      </div>

      <!-- Channel Filters -->
      <div class="channel-filter-group">
        <button
          class="channel-btn"
          class:active={layerStore.tableChannel === 'all'}
          onclick={() => (layerStore.tableChannel = 'all')}
        >
          ALL
        </button>
        <button
          class="channel-btn btn-flight"
          class:active={layerStore.tableChannel === 'flight'}
          onclick={() => (layerStore.tableChannel = 'flight')}
        >
          ADS-B
        </button>
        <button
          class="channel-btn btn-marine"
          class:active={layerStore.tableChannel === 'marine'}
          onclick={() => (layerStore.tableChannel = 'marine')}
        >
          AIS
        </button>
        <button
          class="channel-btn btn-quake"
          class:active={layerStore.tableChannel === 'quake'}
          onclick={() => (layerStore.tableChannel = 'quake')}
        >
          USGS
        </button>
        <button
          class="channel-btn btn-firms"
          class:active={layerStore.tableChannel === 'firms'}
          onclick={() => (layerStore.tableChannel = 'firms')}
        >
          FIRMS
        </button>
        <button
          class="channel-btn btn-gbfs"
          class:active={layerStore.tableChannel === 'gbfs'}
          onclick={() => (layerStore.tableChannel = 'gbfs')}
        >
          GBFS
        </button>
        <button
          class="channel-btn btn-cctv"
          class:active={layerStore.tableChannel === 'cctv'}
          onclick={() => (layerStore.tableChannel = 'cctv')}
        >
          CCTV
        </button>
        <button
          class="channel-btn btn-radio"
          class:active={layerStore.tableChannel === 'radio'}
          onclick={() => (layerStore.tableChannel = 'radio')}
        >
          RADIO
        </button>
        <button
          class="channel-btn btn-launch"
          class:active={layerStore.tableChannel === 'launch'}
          onclick={() => (layerStore.tableChannel = 'launch')}
        >
          LAUNCH
        </button>
        <button
          class="channel-btn btn-weather"
          class:active={layerStore.tableChannel === 'weather'}
          onclick={() => (layerStore.tableChannel = 'weather')}
        >
          WX
        </button>
      </div>

      <!-- Search & Close -->
      <div class="search-actions">
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input
            id="telemetry-search-input"
            type="text"
            placeholder="Search callsign, MMSI, location..."
            bind:value={layerStore.tableQuery}
          />
          {#if layerStore.tableQuery}
            <button class="clear-search-btn" onclick={() => (layerStore.tableQuery = '')}>✕</button>
          {/if}
        </div>
        <button
          id="close-table-btn"
          class="close-table-btn"
          onclick={() => layerStore.toggleTable(false)}
          title="Close table"
        >
          ✕
        </button>
      </div>
    </div>

    <!-- Table Columns Header -->
    <div class="columns-header">
      <div class="col col-kind">DOMAIN</div>
      <div class="col col-id">CALLSIGN / NAME</div>
      <div class="col col-metric1">PRIMARY METRIC</div>
      <div class="col col-metric2">SECONDARY METRIC</div>
      <div class="col col-coords">COORDINATES</div>
      <div class="col col-time">STATUS / TIME</div>
      <div class="col col-action">ACTION</div>
    </div>

    <!-- Virtualized Scroll Viewport -->
    <div
      bind:this={scrollContainer}
      class="virtual-viewport"
      onscroll={handleScroll}
      style="height: {viewportHeight}px;"
    >
      <div class="virtual-scroll-track" style="height: {totalHeight}px;">
        {#each visibleItems as { item, virtualIndex, offsetY } (item.kind + '-' + item.id)}
          <div
            class="virtual-row"
            class:selected={layerStore.selectedEntity?.id === item.id}
            style="transform: translateY({offsetY}px); height: {rowHeight}px;"
            onclick={() => handleSelectRow(item)}
            onkeydown={(e) => e.key === 'Enter' && handleSelectRow(item)}
            role="button"
            tabindex="0"
          >
            <div class="col col-kind">
              <span
                class="kind-badge"
                style="background: {getKindColor(item.kind)}20; color: {getKindColor(item.kind)}; border-color: {getKindColor(item.kind)}50;"
              >
                {item.kind.toUpperCase()}
              </span>
            </div>
            <div class="col col-id mono font-semibold" title={item.name}>
              {item.name}
            </div>
            <div class="col col-metric1 mono text-slate-300">
              {item.metric1}
            </div>
            <div class="col col-metric2 mono text-slate-400">
              {item.metric2}
            </div>
            <div class="col col-coords mono text-slate-400 text-xs">
              {item.coordinates}
            </div>
            <div class="col col-time mono text-slate-400 text-xs">
              {item.timeText}
            </div>
            <div class="col col-action">
              <button class="focus-btn" onclick={(e) => { e.stopPropagation(); handleSelectRow(item); }}>
                🎯 Focus
              </button>
            </div>
          </div>
        {/each}

        {#if totalItems === 0}
          <div class="empty-state">
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
    background: rgba(15, 23, 42, 0.94);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-radius: 8px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6), 0 0 16px rgba(56, 189, 248, 0.15);
    z-index: 40;
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: #f8fafc;
  }

  .table-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 14px;
    background: rgba(3, 7, 18, 0.6);
    border-bottom: 1px solid rgba(148, 163, 184, 0.15);
    gap: 12px;
    flex-wrap: wrap;
  }

  .header-title-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .pulse-icon {
    color: #22c55e;
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
    color: #f8fafc;
  }

  .count-badge {
    font-size: 0.68rem;
    background: rgba(56, 189, 248, 0.15);
    color: #38bdf8;
    border: 1px solid rgba(56, 189, 248, 0.3);
    padding: 2px 6px;
    border-radius: 4px;
  }

  .channel-filter-group {
    display: flex;
    gap: 4px;
    align-items: center;
    flex-wrap: wrap;
  }

  .channel-btn {
    background: rgba(30, 41, 59, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: #94a3b8;
    font-size: 0.65rem;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .channel-btn:hover {
    background: rgba(51, 65, 85, 0.8);
    color: #f8fafc;
  }

  .channel-btn.active {
    background: #38bdf8;
    color: #030712;
    border-color: #38bdf8;
    font-weight: 700;
  }

  .btn-flight.active { background: #38bdf8; color: #030712; }
  .btn-marine.active { background: #2dd4bf; color: #030712; }
  .btn-quake.active { background: #fb923c; color: #030712; }
  .btn-firms.active { background: #f43f5e; color: #ffffff; }
  .btn-gbfs.active { background: #818cf8; color: #030712; }
  .btn-cctv.active { background: #c084fc; color: #030712; }
  .btn-radio.active { background: #38bdf8; color: #030712; }
  .btn-launch.active { background: #fbbf24; color: #030712; }
  .btn-weather.active { background: #60a5fa; color: #030712; }

  .search-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .search-box {
    display: flex;
    align-items: center;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.25);
    border-radius: 4px;
    padding: 2px 8px;
    gap: 6px;
  }

  .search-icon {
    font-size: 0.75rem;
    color: #64748b;
  }

  .search-box input {
    background: transparent;
    border: none;
    outline: none;
    color: #f8fafc;
    font-size: 0.75rem;
    font-family: inherit;
    width: 180px;
  }

  .search-box input::placeholder {
    color: #64748b;
  }

  .clear-search-btn {
    background: none;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    font-size: 0.7rem;
    padding: 0;
  }

  .close-table-btn {
    background: rgba(30, 41, 59, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: #94a3b8;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .close-table-btn:hover {
    color: #f8fafc;
    background: rgba(239, 68, 68, 0.3);
    border-color: #ef4444;
  }

  .columns-header {
    display: grid;
    grid-template-columns: 80px 1.5fr 1.2fr 1.2fr 1.2fr 100px 90px;
    padding: 6px 12px;
    background: rgba(3, 7, 18, 0.8);
    border-bottom: 1px solid rgba(148, 163, 184, 0.15);
    font-size: 0.68rem;
    font-weight: 700;
    color: #94a3b8;
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
    background: rgba(3, 7, 18, 0.5);
  }

  .virtual-viewport::-webkit-scrollbar-thumb {
    background: rgba(148, 163, 184, 0.3);
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
    border-bottom: 1px solid rgba(148, 163, 184, 0.08);
    font-size: 0.75rem;
    cursor: pointer;
    transition: background 0.1s ease;
  }

  .virtual-row:hover {
    background: rgba(56, 189, 248, 0.08);
  }

  .virtual-row.selected {
    background: rgba(56, 189, 248, 0.18);
    border-left: 3px solid #38bdf8;
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
    background: rgba(56, 189, 248, 0.15);
    border: 1px solid rgba(56, 189, 248, 0.3);
    color: #38bdf8;
    font-size: 0.65rem;
    font-family: ui-monospace, monospace;
    padding: 2px 6px;
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .focus-btn:hover {
    background: #38bdf8;
    color: #030712;
  }

  .empty-state {
    padding: 32px;
    text-align: center;
    color: #94a3b8;
    font-size: 0.8rem;
  }
</style>
