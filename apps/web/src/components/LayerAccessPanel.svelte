<script lang="ts">
  import {
    filterLayerAccessEntries,
    type LayerAccessEntry,
    type LayerEffectiveAccessState,
  } from '@gev/contracts';
  import { onDestroy, onMount, tick } from 'svelte';
  import { layerAccessStore } from '../stores/layerAccess.svelte.js';
  import LayerAccessEntryDetail from './LayerAccessEntryDetail.svelte';

  let {
    initialProviderId = null,
    onclose,
  }: { initialProviderId?: string | null; onclose: () => void } = $props();
  let query = $state('');
  let filter = $state<LayerEffectiveAccessState | 'all'>('all');
  let selectedId = $state<string | null>(null);
  let searchInput = $state<HTMLInputElement>();
  let panel = $state<HTMLElement>();
  const abortController = new AbortController();
  const suspendedBackground: HTMLElement[] = [];

  const filteredEntries = $derived(
    filterLayerAccessEntries(layerAccessStore.model?.entries ?? [], query, filter)
  );
  const groups = $derived.by(() => {
    const result: Array<{ domain: string; entries: LayerAccessEntry[] }> = [];
    for (const entry of filteredEntries) {
      const current = result.at(-1);
      if (!current || current.domain !== entry.domain) {
        result.push({ domain: entry.domain, entries: [entry] });
      } else {
        current.entries.push(entry);
      }
    }
    return result;
  });
  const selectedEntry = $derived(
    layerAccessStore.model?.entries.find((entry) => entry.id === selectedId) ??
      filteredEntries[0] ??
      null
  );

  function close(): void {
    onclose();
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (event.key !== 'Tab' || !panel) return;
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (!panel.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    }
  }

  function suspendBackgroundInteraction(): void {
    const app = document.querySelector('.app-layout');
    if (!app || !panel) return;
    for (const child of app.children) {
      if (!(child instanceof HTMLElement) || child === panel || child.classList.contains('backdrop')) {
        continue;
      }
      if (!child.inert) {
        child.inert = true;
        suspendedBackground.push(child);
      }
    }
    document.body.classList.add('layer-access-modal-open');
  }

  async function focusInitialTarget(): Promise<void> {
    await tick();
    if (initialProviderId) {
      panel.querySelector<HTMLElement>(`#layer-access-entry-${initialProviderId}`)?.focus();
    } else {
      searchInput?.focus();
    }
  }

  onMount(async () => {
    selectedId = initialProviderId;
    suspendBackgroundInteraction();
    await layerAccessStore.load(abortController.signal);
    await focusInitialTarget();
  });

  onDestroy(() => {
    abortController.abort();
    for (const element of suspendedBackground) element.inert = false;
    document.body.classList.remove('layer-access-modal-open');
  });
</script>

<svelte:window onkeydown={onWindowKeydown} />
<button
  class="backdrop"
  aria-label="Close Layer Access settings"
  tabindex="-1"
  onclick={close}
></button>
<div
  bind:this={panel}
  id="layer-access-panel"
  class="layer-access-panel"
  role="dialog"
  aria-modal="true"
  aria-labelledby="layer-access-heading"
>
  <header class="panel-header">
    <div>
      <p>Settings</p>
      <h2 id="layer-access-heading">Layer Access</h2>
      <small>Registry-derived setup, policy, and runtime truth</small>
    </div>
    <button class="close-button" aria-label="Close Layer Access settings" onclick={close}>×</button>
  </header>

  {#if layerAccessStore.loadState === 'loading' || layerAccessStore.loadState === 'idle'}
    <div class="state-card" role="status">Loading the authenticated registry projection…</div>
  {:else if layerAccessStore.loadState === 'error'}
    <div class="state-card error" role="alert">
      <strong>Layer Access unavailable</strong>
      <p>{layerAccessStore.error}</p>
      <button onclick={() => layerAccessStore.load(abortController.signal)}>Retry</button>
    </div>
  {:else if layerAccessStore.model}
    <div class="summary-bar" aria-label="Layer Access summary">
      <span><strong>{layerAccessStore.model.counts.registry.providers.total}</strong> providers</span>
      <span><strong>{layerAccessStore.model.counts.registry.feeds.total}</strong> feeds</span>
      <span><strong>{layerAccessStore.model.counts.registry.layers.total}</strong> layers</span>
      <span class="mono">Snapshot {layerAccessStore.model.generated_at}</span>
    </div>
    {#if layerAccessStore.model.authority.credential_status_access === 'unavailable'}
      <p class="authority-note" role="status">{layerAccessStore.model.authority.reason}</p>
    {/if}
    <div class="controls">
      <label>
        <span>Search provider, feed, layer, or product</span>
        <input
          bind:this={searchInput}
          id="layer-access-search"
          type="search"
          bind:value={query}
          autocomplete="off"
          placeholder="Search all accepted entries"
        />
      </label>
      <label>
        <span>Effective access</span>
        <select id="layer-access-filter" bind:value={filter}>
          <option value="all">All states</option>
          <option value="available">Available</option>
          <option value="setup_required">Setup required</option>
          <option value="approval_required">Approval required</option>
          <option value="configuration_required">Configuration required</option>
          <option value="planned">Planned</option>
          <option value="disabled">Disabled by policy</option>
          <option value="stasis">STASIS</option>
          <option value="unavailable">Unavailable</option>
        </select>
      </label>
      <span class="result-count" aria-live="polite">
        {filteredEntries.length} shown of {layerAccessStore.model.entries.length}
      </span>
    </div>

    <div class="panel-grid">
      <nav class="entry-list" aria-label="Layer Access entries">
        {#each groups as group}
          <section aria-labelledby={`layer-access-domain-${group.domain}`}>
            <h3 id={`layer-access-domain-${group.domain}`}>
              {group.domain.replaceAll('-', ' ')}
            </h3>
            {#each group.entries as entry}
              <button
                id={`layer-access-entry-${entry.id}`}
                class:active={selectedEntry?.id === entry.id}
                onclick={() => (selectedId = entry.id)}
                aria-label={`${entry.provider_name}: ${entry.effective_access.replaceAll('_', ' ')}`}
              >
                <span>{entry.provider_name}</span>
                <small>{entry.layers.map((layer) => layer.name).join(' · ')}</small>
                <em>{entry.effective_access.replaceAll('_', ' ')}</em>
              </button>
            {/each}
          </section>
        {:else}
          <p class="empty-state">No accepted registry entries match these filters.</p>
        {/each}
      </nav>
      <div class="detail-pane">
        {#if selectedEntry}
          <LayerAccessEntryDetail entry={selectedEntry} />
        {:else}
          <p class="empty-state">Select an entry to inspect its independent gates.</p>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 3000; border: 0; background: var(--hud-surface-dark-faint); cursor: default; }
  .layer-access-panel { position: fixed; z-index: 3001; inset: 28px 28px 28px 360px; display: flex; flex-direction: column; min-width: 0; overflow: hidden; border: 1px solid var(--hud-border-prominent); border-radius: 12px; background: var(--hud-panel-bg-overlay); backdrop-filter: blur(16px); box-shadow: 0 12px 40px var(--hud-shadow); color: var(--hud-text-primary); pointer-events: auto; }
  .panel-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid var(--hud-border); }
  .panel-header p { margin: 0 0 3px; color: var(--hud-accent); font: 700 0.67rem ui-monospace, monospace; text-transform: uppercase; }
  h2 { margin: 0; font-size: 1.15rem; }
  .panel-header small { color: var(--hud-text-secondary); }
  .close-button { border: 1px solid var(--hud-border-solid-soft); border-radius: 6px; background: var(--hud-row-bg); color: var(--hud-text-primary); font-size: 1.35rem; cursor: pointer; }
  .summary-bar { display: flex; gap: 16px; align-items: center; padding: 8px 18px; border-bottom: 1px solid var(--hud-divider); color: var(--hud-text-secondary); font-size: 0.7rem; }
  .summary-bar strong { color: var(--hud-text-data); }
  .summary-bar .mono { margin-left: auto; font-family: ui-monospace, monospace; }
  .authority-note { margin: 0; padding: 7px 18px; border-bottom: 1px solid var(--hud-border-muted); color: var(--hud-warning); font-size: 0.7rem; }
  .controls { display: grid; grid-template-columns: minmax(220px, 1fr) 190px auto; gap: 10px; align-items: end; padding: 10px 18px; border-bottom: 1px solid var(--hud-border); }
  label { display: grid; gap: 4px; color: var(--hud-text-secondary); font-size: 0.67rem; }
  input, select { min-width: 0; border: 1px solid var(--hud-border-solid-soft); border-radius: 5px; padding: 7px 9px; background: var(--hud-surface-dark-strong); color: var(--hud-text-data); }
  input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid var(--hud-accent); outline-offset: 2px; }
  .result-count { padding-bottom: 8px; color: var(--hud-text-secondary); font: 0.68rem ui-monospace, monospace; }
  .panel-grid { display: grid; grid-template-columns: minmax(220px, 31%) 1fr; min-height: 0; flex: 1; }
  .entry-list, .detail-pane { overflow: auto; scrollbar-color: var(--hud-border-solid-soft) transparent; }
  .entry-list { padding: 10px; border-right: 1px solid var(--hud-border); }
  .entry-list section + section { margin-top: 12px; }
  .entry-list h3 { margin: 0 4px 5px; color: var(--hud-text-dim); font-size: 0.63rem; letter-spacing: 0.07em; text-transform: uppercase; }
  .entry-list button { display: grid; width: 100%; gap: 2px; margin: 0 0 5px; border: 1px solid var(--hud-border-faint); border-radius: 6px; padding: 8px; background: var(--hud-row-bg); color: var(--hud-text-panel); text-align: left; cursor: pointer; }
  .entry-list button.active { border-color: var(--hud-accent-border); background: var(--hud-accent-faint); }
  .entry-list button span { font-size: 0.74rem; font-weight: 700; }
  .entry-list button small { color: var(--hud-text-secondary); font-size: 0.64rem; }
  .entry-list button em { color: var(--hud-warning); font: normal 0.61rem ui-monospace, monospace; text-transform: uppercase; }
  .detail-pane { padding: 16px 18px 28px; }
  .state-card { margin: 20px; border: 1px solid var(--hud-border); border-radius: 8px; padding: 16px; color: var(--hud-text-secondary); }
  .state-card.error { border-color: var(--hud-danger); }
  .state-card p, .empty-state { color: var(--hud-text-secondary); font-size: 0.75rem; }
  .state-card button { border: 1px solid var(--hud-accent-border); border-radius: 5px; padding: 6px 10px; background: var(--hud-accent-soft); color: var(--hud-accent); cursor: pointer; }
  @media (max-width: 900px) { .layer-access-panel { inset: 16px; } .controls { grid-template-columns: 1fr; } .result-count { padding: 0; } .panel-grid { grid-template-columns: 1fr; } .entry-list { max-height: 32vh; border-right: 0; border-bottom: 1px solid var(--hud-border); } }
</style>
