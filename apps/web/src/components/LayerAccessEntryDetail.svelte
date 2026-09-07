<script lang="ts">
  import type { LayerAccessEntry } from '@gev/contracts';

  let { entry }: { entry: LayerAccessEntry } = $props();

  function label(value: string | null): string {
    return value ? value.replaceAll('_', ' ').toUpperCase() : 'STATUS UNAVAILABLE';
  }

  function displayTime(value: string | null): string {
    return value ?? 'Not exposed by current authority';
  }

  function documentationUrl(path: string): string {
    return `https://github.com/DDS-Solutions/AI-TadPole-Eye-View/blob/main/${path}`;
  }
</script>

<section class="entry-detail" aria-labelledby={`layer-access-title-${entry.id}`}>
  <header class="detail-header">
    <div>
      <p class="eyebrow">{entry.domain.replaceAll('-', ' ')}</p>
      <h3 id={`layer-access-title-${entry.id}`}>{entry.provider_name}</h3>
      <p class="source-line">{entry.source.name} · {entry.runtime.mode.toUpperCase()}</p>
    </div>
    <span class:warning={entry.effective_access !== 'available'} class="status-pill">
      {label(entry.effective_access)}
    </span>
  </header>

  {#if entry.lock_reasons.length > 0}
    <section class="callout" aria-label="Lock reasons">
      <h4>Why access is limited</h4>
      <ul>
        {#each entry.lock_reasons as reason}
          <li><span>{label(reason.gate)}</span> {reason.message}</li>
        {/each}
      </ul>
    </section>
  {/if}

  <div class="gate-grid" aria-label="Independent access gates">
    <section class="gate-card">
      <h4>Implementation</h4>
      <strong>{label(entry.implementation)}</strong>
      <p>{entry.layers.map((layer) => layer.name).join(' · ')}</p>
      <small>{entry.feeds.map((feed) => feed.name).join(' · ')}</small>
    </section>

    <section class="gate-card">
      <h4>Credential</h4>
      <strong>{label(entry.credential.status)}</strong>
      <p>{entry.credential.kind.replaceAll('_', ' ')}</p>
      {#if entry.credential.masked_fingerprint}
        <code aria-label="Masked credential fingerprint">{entry.credential.masked_fingerprint}</code>
      {:else if entry.credential.local_status.visibility === 'unavailable'}
        <small>{entry.credential.local_status.reason}</small>
      {/if}
      {#if entry.credential.required_scopes.length > 0}
        <small>Scopes: {entry.credential.required_scopes.join(', ')}</small>
      {/if}
    </section>

    <section class="gate-card">
      <h4>Terms</h4>
      <strong>{label(entry.terms.status)}</strong>
      <p>Owner: {entry.terms.owner}</p>
      {#if entry.terms.local_status.visibility === 'unavailable'}
        <small>{entry.terms.local_status.reason}</small>
      {:else}
        <small>Reviewed: {displayTime(entry.terms.reviewed_at)}</small>
      {/if}
    </section>

    <section class="gate-card">
      <h4>Configuration</h4>
      <strong>{label(entry.configuration.current_state)}</strong>
      <p>{entry.configuration.description}</p>
      {#if entry.configuration.local_status.visibility === 'unavailable'}
        <small>{entry.configuration.local_status.reason}</small>
      {/if}
    </section>

    <section class="gate-card">
      <h4>Policy</h4>
      <strong>{entry.policy.enabled ? 'ENABLED' : 'DISABLED'}</strong>
      <p>{entry.policy.kill_switch}</p>
      <small>Owner: {entry.policy.kill_switch_owner}</small>
    </section>

    <section class="gate-card">
      <h4>Runtime</h4>
      <strong>{label(entry.runtime.status)}</strong>
      <p>{entry.runtime.detail ?? 'No runtime exception reported'}</p>
      <small>Budget remaining: ${entry.policy.budget_remaining_usd.toFixed(2)}</small>
    </section>
  </div>

  <section class="detail-section">
    <h4>Source time and delivery</h4>
    <dl class="time-grid mono">
      <div><dt>Observation</dt><dd>{displayTime(entry.runtime.observation_at)}</dd></div>
      <div><dt>Retrieved</dt><dd>{displayTime(entry.runtime.retrieved_at)}</dd></div>
      <div><dt>Cache origin</dt><dd>{displayTime(entry.runtime.cache_origin_at)}</dd></div>
      <div><dt>Last success</dt><dd>{displayTime(entry.runtime.last_success_at)}</dd></div>
      <div><dt>Last error</dt><dd>{displayTime(entry.runtime.last_error_at)}</dd></div>
      <div><dt>Next poll</dt><dd>{displayTime(entry.runtime.next_poll_at)}</dd></div>
    </dl>
  </section>

  <section class="detail-section">
    <h4>Products</h4>
    {#each entry.products as product}
      <article class="product">
        <strong>{product.name}</strong>
        <p>{product.coverage}</p>
        <small>{product.transport.toUpperCase()} · {product.formats.join(', ')}</small>
        <small>{product.time_semantics}</small>
      </article>
    {/each}
  </section>

  <section class="detail-section policy-copy">
    <h4>Cost, cache, and request policy</h4>
    <dl>
      <div><dt>Refresh</dt><dd class="mono">{entry.policy.refresh_seconds}s</dd></div>
      <div><dt>Fresh cache</dt><dd class="mono">{entry.policy.fresh_cache_seconds}s</dd></div>
      <div><dt>Maximum stale</dt><dd class="mono">{entry.policy.max_stale_seconds}s</dd></div>
      <div><dt>Rate</dt><dd>{entry.policy.upstream_rate_limit}</dd></div>
      <div><dt>Budget</dt><dd>{entry.policy.budget_policy}</dd></div>
      <div><dt>Fallback</dt><dd>{entry.policy.fallback}</dd></div>
    </dl>
  </section>

  <section class="detail-section">
    <h4>Set up safely</h4>
    <ol>
      {#each entry.setup_instructions as instruction}
        <li>{instruction}</li>
      {/each}
    </ol>
    <p class="write-lock">Credential and terms changes remain disabled until Phase 7 administration.</p>
  </section>

  <nav class="source-links" aria-label="Authoritative source links">
    <a href={entry.credential.setup_url} target="_blank" rel="noreferrer">Setup</a>
    <a href={entry.terms.terms_url} target="_blank" rel="noreferrer">Terms</a>
    <a href={entry.terms.attribution_url} target="_blank" rel="noreferrer">Attribution</a>
    {#each entry.documentation_paths as path}
      <a href={documentationUrl(path)} target="_blank" rel="noreferrer">Source document</a>
    {/each}
  </nav>
</section>

<style>
  .entry-detail { display: grid; gap: 14px; }
  .detail-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .eyebrow { margin: 0 0 4px; color: var(--hud-accent); font: 700 0.67rem ui-monospace, monospace; text-transform: uppercase; }
  h3 { margin: 0; color: var(--hud-text-primary); font-size: 1.25rem; }
  h4 { margin: 0 0 8px; color: var(--hud-text-panel); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; }
  p { margin: 4px 0; color: var(--hud-text-secondary); font-size: 0.75rem; line-height: 1.45; }
  small { display: block; color: var(--hud-text-dim); font-size: 0.68rem; line-height: 1.4; }
  .source-line { font-family: ui-monospace, monospace; }
  .status-pill { border: 1px solid var(--hud-accent-border); border-radius: 999px; padding: 5px 8px; color: var(--hud-accent); font: 700 0.65rem ui-monospace, monospace; white-space: nowrap; }
  .status-pill.warning { border-color: var(--hud-border-solid-soft); color: var(--hud-warning); }
  .callout { border: 1px solid var(--hud-border-solid-soft); border-left: 3px solid var(--hud-warning); border-radius: 6px; padding: 10px 12px; background: var(--hud-surface-dark-soft); }
  ul, ol { margin: 0; padding-left: 20px; color: var(--hud-text-secondary); font-size: 0.72rem; line-height: 1.5; }
  li span { color: var(--hud-warning); font-family: ui-monospace, monospace; }
  .gate-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .gate-card, .product { min-width: 0; border: 1px solid var(--hud-border-muted); border-radius: 6px; padding: 10px; background: var(--hud-row-bg); }
  .gate-card strong { color: var(--hud-text-data); font: 700 0.72rem ui-monospace, monospace; }
  code { display: inline-block; margin-top: 6px; color: var(--hud-accent); }
  .detail-section { border-top: 1px solid var(--hud-divider); padding-top: 12px; }
  .time-grid, .policy-copy dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 16px; margin: 0; }
  dl div { min-width: 0; }
  dt { color: var(--hud-text-dim); font-size: 0.65rem; text-transform: uppercase; }
  dd { margin: 2px 0 0; color: var(--hud-text-data); font-size: 0.69rem; overflow-wrap: anywhere; }
  .product + .product { margin-top: 6px; }
  .product strong { color: var(--hud-text-data); font-size: 0.75rem; }
  .policy-copy dd { font-family: inherit; line-height: 1.4; }
  .policy-copy dd.mono, .mono { font-family: ui-monospace, monospace; font-variant-numeric: tabular-nums; }
  .write-lock { color: var(--hud-warning); }
  .source-links { display: flex; flex-wrap: wrap; gap: 8px; }
  .source-links a { border: 1px solid var(--hud-accent-border); border-radius: 4px; padding: 5px 8px; color: var(--hud-accent); font-size: 0.7rem; text-decoration: none; }
  .source-links a:focus-visible, .source-links a:hover { background: var(--hud-accent-soft); outline: none; }
  @media (max-width: 820px) { .gate-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
