<script lang="ts">
  import type { CompareLocationsOutput } from '@gev/contracts';
  import { formatEstimate } from './formatters.js';

  interface Props {
    result: CompareLocationsOutput;
  }

  const { result }: Props = $props();
</script>

<div class="comparison-container" id="location-comparison-table-wrap">
  <table class="comparison-table" id="location-comparison-table">
    <thead>
      <tr>
        <th>METRIC</th>
        {#each result.locations as loc (loc.location_key)}
          <th>
            {loc.label}
            {#if loc.location_key === result.benchmark_location_key}
              <span class="benchmark-pill mono">BENCHMARK</span>
            {/if}
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each result.metrics as metricRow (metricRow.metric_id)}
        <tr>
          <td class="font-semibold">{metricRow.label}</td>
          {#each metricRow.values as val (val.location_key)}
            <td class="mono">
              {formatEstimate(
                val.estimate,
                metricRow.metric_id.includes('income') || metricRow.metric_id.includes('payroll') ? '$' : ''
              )}
              {#if typeof val.delta_from_benchmark_percent === 'number' && val.location_key !== result.benchmark_location_key}
                <span class="delta-tag {val.delta_from_benchmark_percent >= 0 ? 'pos' : 'neg'}">
                  {val.delta_from_benchmark_percent >= 0 ? '+' : ''}{val.delta_from_benchmark_percent.toFixed(1)}%
                </span>
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .comparison-container {
    overflow-x: auto;
    border: 1px solid var(--hud-border);
    border-radius: 6px;
    background: var(--hud-panel-bg);
  }

  .comparison-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.72rem;
  }

  .comparison-table th {
    background: var(--hud-surface-dark-strong);
    padding: 8px 10px;
    text-align: left;
    color: var(--hud-text-dim);
    font-size: 0.65rem;
    letter-spacing: 0.05em;
    border-bottom: 1px solid var(--hud-border-strong);
  }

  .comparison-table td {
    padding: 6px 10px;
    border-bottom: 1px solid var(--hud-divider);
  }

  .benchmark-pill {
    background: var(--hud-accent-faint);
    color: var(--hud-accent);
    border: 1px solid var(--hud-accent-border);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 0.58rem;
    margin-left: 4px;
  }

  .delta-tag {
    font-size: 0.65rem;
    padding: 1px 4px;
    border-radius: 3px;
    margin-left: 4px;
  }

  .delta-tag.pos {
    background: var(--hud-success-soft);
    color: var(--hud-success);
  }

  .delta-tag.neg {
    background: var(--hud-danger-soft);
    color: var(--hud-danger);
  }

  .mono {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }

  .font-semibold {
    font-weight: 600;
  }
</style>
