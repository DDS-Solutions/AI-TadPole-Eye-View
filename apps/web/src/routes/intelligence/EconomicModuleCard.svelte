<script lang="ts">
  import type { EconomicModule } from './economicModulesData.js';

  let { module: mod }: { module: EconomicModule } = $props();
</script>

<article class="module-card" id={`card-${mod.id}`}>
  <div class="card-header">
    <span class="phase-tag mono">{mod.phase}</span>
    <span class="status-badge status-planned mono">{mod.status}</span>
  </div>
  <h3 class="card-title">{mod.title}</h3>
  <div class="card-badge-row">
    <span class="domain-badge mono">{mod.badge}</span>
  </div>

  <!-- Empty State per DESIGN.md §5.1 -->
  <div class="empty-state-box">
    <span class="empty-state-code mono">STATE: {mod.status}</span>
    <p class="empty-state-text">{mod.statusReason}</p>
  </div>

  <div class="data-sources-section">
    <span class="sources-label">PLANNED DATA SOURCES</span>
    <ul class="sources-list">
      {#each mod.sources as src}
        <li class="source-item mono">{src}</li>
      {/each}
    </ul>
  </div>

  <div class="card-metrics-grid">
    {#each mod.metrics as m}
      <div class="card-metric">
        <span class="card-metric-label">{m.label}</span>
        <span class="card-metric-value mono">{m.value}</span>
      </div>
    {/each}
  </div>
</article>

<style>
  .module-card {
    background: var(--hud-panel-bg);
    backdrop-filter: blur(12px);
    border: 1px solid var(--hud-border);
    border-radius: 8px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    transition: transform 0.15s ease, border-color 0.15s ease;
  }

  .module-card:hover {
    border-color: var(--hud-border-prominent);
    transform: translateY(-2px);
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .phase-tag {
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--hud-accent);
  }

  .status-badge {
    font-size: 0.65rem;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 4px;
    letter-spacing: 0.06em;
  }

  .status-planned {
    background: var(--hud-chip-bg);
    border: 1px solid var(--hud-chip-border);
    color: var(--hud-text-secondary);
  }

  .card-title {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--hud-text-primary);
  }

  .card-badge-row {
    display: flex;
  }

  .domain-badge {
    font-size: 0.65rem;
    background: var(--hud-surface-dark-soft);
    border: 1px solid var(--hud-border-muted);
    color: var(--hud-text-mid);
    padding: 2px 6px;
    border-radius: 4px;
  }

  .empty-state-box {
    background: var(--hud-row-bg);
    border: 1px dashed var(--hud-border);
    border-radius: 6px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .empty-state-code {
    font-size: 0.65rem;
    font-weight: 700;
    color: var(--hud-warning);
    letter-spacing: 0.06em;
  }

  .empty-state-text {
    margin: 0;
    font-size: 0.74rem;
    color: var(--hud-text-secondary);
    line-height: 1.35;
  }

  .data-sources-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .sources-label {
    font-size: 0.62rem;
    font-weight: 700;
    color: var(--hud-text-dim);
    letter-spacing: 0.06em;
  }

  .sources-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .source-item {
    font-size: 0.72rem;
    color: var(--hud-text-mid);
    padding-left: 10px;
    position: relative;
  }

  .source-item::before {
    content: '•';
    position: absolute;
    left: 0;
    color: var(--hud-accent);
  }

  .card-metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
    gap: 8px;
    padding-top: 6px;
    border-top: 1px solid var(--hud-divider);
  }

  .card-metric {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .card-metric-label {
    font-size: 0.58rem;
    font-weight: 700;
    color: var(--hud-text-dim);
    letter-spacing: 0.05em;
  }

  .card-metric-value {
    font-size: 0.68rem;
    color: var(--hud-text-panel);
    font-weight: 500;
  }

  .mono {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }
</style>
