<script lang="ts">
  import type { WorkforceAnalysisResult } from '@gev/contracts';
  import { formatEstimate } from './formatters.js';

  interface Props {
    result: WorkforceAnalysisResult;
  }

  const { result }: Props = $props();

  let showEvidenceDrawer = $state(false);
</script>

<div class="workforce-tab" id="workforce-tab-content">
  <!-- Prominent Statutory Labor-Market Signal Banner -->
  <div class="labor-market-signal-banner" id="workforce-labor-market-signal-banner">
    <div class="signal-header">
      <span class="badge-signal">STATISTICAL LABOR-MARKET SIGNAL</span>
      <span class="signal-title">Aggregate Benchmark Survey Estimates (BLS OEWS &amp; LAU)</span>
    </div>
    <div class="signal-body">
      {result.disclaimer}
    </div>
  </div>

  {#if result.disagreement_state.has_disagreements}
    <div class="disagreement-banner" id="workforce-disagreement-banner">
      <div class="disagreement-header">
        <span class="badge-disagreement">UNRESOLVED_PRESERVED</span>
        <span class="disagreement-title">Survey &amp; Model Disagreements Detected ({result.disagreement_state.total_disagreements})</span>
      </div>
      {#each result.disagreement_state.records as record (record.disagreement_id)}
        <div class="disagreement-item">
          <span class="disagreement-sev mono">[{record.severity.toUpperCase()}]</span>
          <span class="disagreement-desc">{record.delta_description}</span>
          <span class="disagreement-srcs mono">{record.expected_signal.source_metric} vs {record.observed_signal.source_metric}</span>
        </div>
      {/each}
    </div>
  {/if}

  <div class="metrics-cards-grid">
    <!-- Unemployment & Labor Force Dynamics Card -->
    <div class="metric-card" id="workforce-unemployment-card">
      <div class="card-title-row">
        <span class="card-icon">📊</span>
        <span class="card-title">Unemployment &amp; Labor Dynamics (BLS LAU)</span>
      </div>
      <div class="metric-row">
        <span class="metric-name">Unemployment Rate</span>
        <div class="metric-val-group">
          <span class="metric-val mono" id="metric-unemployment-rate">
            {formatEstimate(result.unemployment_dynamics.unemployment_rate_pct)}%
          </span>
          <span class="badge-status mono" id="unemployment-status-badge">
            {result.unemployment_dynamics.unemployment_status.toUpperCase()}
          </span>
        </div>
      </div>
      <div class="metric-row">
        <span class="metric-name">Civilian Labor Force</span>
        <span class="metric-val mono" id="metric-labor-force">
          {formatEstimate(result.unemployment_dynamics.civilian_labor_force)}
        </span>
      </div>
      <div class="metric-row">
        <span class="metric-name">Resident Employed</span>
        <span class="metric-val mono" id="metric-employed-count">
          {formatEstimate(result.unemployment_dynamics.employed_count)}
        </span>
      </div>
      <div class="metric-row">
        <span class="metric-name">Resident Unemployed</span>
        <span class="metric-val mono" id="metric-unemployed-count">
          {formatEstimate(result.unemployment_dynamics.unemployed_count)}
        </span>
      </div>
      <div class="statutory-note mono">
        Period: {result.unemployment_dynamics.period} {result.unemployment_dynamics.year} | Model: Monthly Resident Population
      </div>
    </div>

    <!-- Wage Differentials & Percentiles Card -->
    <div class="metric-card" id="workforce-wages-card">
      <div class="card-title-row">
        <span class="card-icon">💵</span>
        <span class="card-title">Wage Differentials (BLS OEWS Percentiles)</span>
      </div>
      <div class="metric-row">
        <span class="metric-name">10th Percentile (Entry)</span>
        <span class="metric-val mono" id="metric-wage-pct10">
          {formatEstimate(result.wage_differentials.hourly_percentiles.pct10, '$')}/hr
        </span>
      </div>
      <div class="metric-row">
        <span class="metric-name">25th Percentile</span>
        <span class="metric-val mono" id="metric-wage-pct25">
          {formatEstimate(result.wage_differentials.hourly_percentiles.pct25, '$')}/hr
        </span>
      </div>
      <div class="metric-row highlight-row">
        <span class="metric-name">Median Wage (50th)</span>
        <span class="metric-val mono accent" id="metric-wage-median">
          {formatEstimate(result.wage_differentials.hourly_percentiles.median, '$')}/hr
        </span>
      </div>
      <div class="metric-row">
        <span class="metric-name">75th Percentile</span>
        <span class="metric-val mono" id="metric-wage-pct75">
          {formatEstimate(result.wage_differentials.hourly_percentiles.pct75, '$')}/hr
        </span>
      </div>
      <div class="metric-row">
        <span class="metric-name">90th Percentile</span>
        <span class="metric-val mono" id="metric-wage-pct90">
          {#if result.wage_differentials.hourly_percentiles.pct90.status === 'suppressed'}
            <span class="badge-suppressed">TOP-CODED (&ge;$115/hr)</span>
          {:else}
            {formatEstimate(result.wage_differentials.hourly_percentiles.pct90, '$')}/hr
          {/if}
        </span>
      </div>
      <div class="metric-row">
        <span class="metric-name">Mean Hourly Wage</span>
        <span class="metric-val mono" id="metric-wage-mean">
          {formatEstimate(result.wage_differentials.hourly_percentiles.mean, '$')}/hr
        </span>
      </div>
      <div class="metric-row divider-top">
        <span class="metric-name">90/10 Wage Ratio</span>
        <span class="metric-val mono" id="metric-ratio-9010">
          {#if result.wage_differentials.ratio_90_10.status === 'suppressed'}
            <span class="badge-suppressed">SUPPRESSED</span>
          {:else}
            {formatEstimate(result.wage_differentials.ratio_90_10)}
          {/if}
        </span>
      </div>
      <div class="metric-row">
        <span class="metric-name">Dispersion Tier</span>
        <span class="badge-tier mono">
          {result.wage_differentials.dispersion_classification.toUpperCase()}
        </span>
      </div>
      <div class="statutory-note">
        Notice: Top-coded rates and confidential series retain suppression flags without zero-coercion.
      </div>
    </div>

    <!-- Occupational Specialization Card -->
    <div class="metric-card" id="workforce-specialization-card">
      <div class="card-title-row">
        <span class="card-icon">🎯</span>
        <span class="card-title">Occupational Specialization (LQ)</span>
      </div>
      <div class="metric-row">
        <span class="metric-name">Target Occupation</span>
        <span class="metric-val mono">{result.occupation_title}</span>
      </div>
      <div class="metric-row">
        <span class="metric-name">SOC Code</span>
        <span class="metric-val mono accent">{result.soc_code}</span>
      </div>
      <div class="metric-row highlight-row">
        <span class="metric-name">Location Quotient (LQ)</span>
        <div class="metric-val-group">
          <span class="metric-val mono accent" id="metric-location-quotient">
            {result.occupational_specialization.location_quotient !== null
              ? result.occupational_specialization.location_quotient.toFixed(2)
              : 'N/A'}
          </span>
          <span class="badge-tier mono" id="metric-specialization-tier">
            {result.occupational_specialization.tier.toUpperCase().replace('_', ' ')}
          </span>
        </div>
      </div>
      <div class="metric-row">
        <span class="metric-name">Local Employment</span>
        <span class="metric-val mono" id="metric-local-soc-employment">
          {formatEstimate(result.occupational_specialization.local_employment)}
        </span>
      </div>
      <div class="metric-row">
        <span class="metric-name">Benchmark Employment</span>
        <span class="metric-val mono" id="metric-benchmark-soc-employment">
          {formatEstimate(result.occupational_specialization.benchmark_employment)}
        </span>
      </div>
      <div class="statutory-note">
        LQ &gt; 1.20 indicates regional workforce concentration relative to national benchmark baseline.
      </div>
    </div>

    <!-- Labor-Market Concentration Card -->
    <div class="metric-card" id="workforce-concentration-card">
      <div class="card-title-row">
        <span class="card-icon">🏛️</span>
        <span class="card-title">Labor-Market Concentration</span>
      </div>
      <div class="metric-row">
        <span class="metric-name">Occupational HHI</span>
        <span class="metric-val mono accent" id="metric-workforce-hhi">
          {result.labor_market_concentration.hhi.toLocaleString()}
        </span>
      </div>
      <div class="metric-row">
        <span class="metric-name">Concentration Tier</span>
        <span class="badge-tier mono" id="metric-concentration-tier">
          {result.labor_market_concentration.tier.toUpperCase().replace('_', ' ')}
        </span>
      </div>
      <div class="metric-row">
        <span class="metric-name">Occupations Evaluated</span>
        <span class="metric-val mono">{result.labor_market_concentration.occupation_count}</span>
      </div>
      <div class="metric-row">
        <span class="metric-name">Top Occupation Share</span>
        <span class="metric-val mono">{result.labor_market_concentration.top_share_pct.toFixed(1)}%</span>
      </div>
      <div class="statutory-note">
        Herfindahl-Hirschman Index computed across major occupational categories in regional economy.
      </div>
    </div>
  </div>

  <!-- Evidence Inspection Toggle & Drawer -->
  <div class="evidence-section">
    <button
      class="evidence-toggle-btn"
      id="workforce-evidence-toggle"
      onclick={() => (showEvidenceDrawer = !showEvidenceDrawer)}
    >
      <span class="toggle-icon">{showEvidenceDrawer ? '▼' : '►'}</span>
      <span>Inspect Workforce Evidence Records &amp; Provenance ({result.evidence_bundle.records.length})</span>
    </button>

    {#if showEvidenceDrawer}
      <div class="evidence-drawer" id="workforce-evidence-drawer">
        <div class="evidence-header mono">
          <span>BUNDLE ID: {result.evidence_bundle.bundle_id}</span>
          <span>MODE: {result.provenance.mode.toUpperCase()}</span>
          <span>LICENSE: {result.provenance.license.name}</span>
        </div>
        <div class="records-table-container">
          <table class="records-table mono">
            <thead>
              <tr>
                <th>SOURCE</th>
                <th>VARIABLE</th>
                <th>METRIC</th>
                <th>ESTIMATE</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {#each result.evidence_bundle.records as rec (rec.evidence_id)}
                <tr>
                  <td>{rec.source_id}</td>
                  <td>{rec.variable_name}</td>
                  <td>{rec.label}</td>
                  <td>{formatEstimate(rec.estimate)}</td>
                  <td>
                    <span class="status-pill status-{rec.estimate.status}">
                      {rec.estimate.status.toUpperCase()}
                    </span>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .workforce-tab { display: flex; flex-direction: column; gap: 16px; }
  .labor-market-signal-banner {
    background: var(--hud-accent-faint);
    border: 1px solid var(--hud-accent-border);
    border-radius: 6px;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .signal-header { display: flex; align-items: center; gap: 10px; }
  .badge-signal {
    background: var(--hud-accent-selected);
    color: var(--hud-accent);
    font-size: 0.62rem;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 3px;
    letter-spacing: 0.05em;
  }
  .signal-title { color: var(--hud-text-primary); font-weight: 600; font-size: 0.8rem; }
  .signal-body { color: var(--hud-text-secondary); font-size: 0.74rem; line-height: 1.4; }

  .disagreement-banner {
    background: var(--channel-launch-soft);
    border: 1px solid var(--hud-warning);
    border-radius: 6px;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .disagreement-header { display: flex; align-items: center; gap: 8px; }
  .badge-disagreement {
    background: var(--hud-warning);
    color: var(--hud-surface-dark);
    font-size: 0.62rem;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 3px;
  }
  .disagreement-title { color: var(--hud-warning); font-weight: 600; font-size: 0.8rem; }
  .disagreement-item { display: flex; align-items: baseline; gap: 8px; font-size: 0.74rem; color: var(--hud-text-secondary); }
  .disagreement-sev { color: var(--hud-warning); font-weight: 700; }
  .disagreement-srcs { color: var(--hud-text-dim); font-size: 0.68rem; }

  .metrics-cards-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
  .metric-card {
    background: var(--hud-panel-bg);
    border: 1px solid var(--hud-border);
    border-radius: 6px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .card-title-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; border-bottom: 1px solid var(--hud-divider); padding-bottom: 6px; }
  .card-icon { font-size: 1rem; }
  .card-title { font-size: 0.86rem; font-weight: 600; color: var(--hud-text-panel); }
  .metric-row { display: flex; justify-content: space-between; align-items: center; font-size: 0.76rem; padding: 2px 0; }
  .highlight-row { background: var(--hud-accent-faint); padding: 4px 6px; border-radius: 4px; }
  .divider-top { border-top: 1px solid var(--hud-divider); padding-top: 6px; margin-top: 4px; }
  .metric-name { color: var(--hud-text-secondary); }
  .metric-val { color: var(--hud-text-primary); font-weight: 500; }
  .metric-val.accent { color: var(--hud-accent); font-weight: 700; }
  .metric-val-group { display: flex; align-items: center; gap: 6px; }
  .badge-status { background: var(--hud-success-soft); color: var(--hud-success); font-size: 0.62rem; padding: 2px 6px; border-radius: 3px; }
  .badge-tier { background: var(--hud-accent-selected); color: var(--hud-accent); font-size: 0.62rem; padding: 2px 6px; border-radius: 3px; }
  .badge-suppressed { background: var(--hud-danger-soft); color: var(--hud-danger); font-size: 0.62rem; font-weight: 700; padding: 2px 6px; border-radius: 3px; }
  .statutory-note { font-size: 0.68rem; color: var(--hud-text-dim); margin-top: 6px; line-height: 1.3; }

  .evidence-section { margin-top: 8px; }
  .evidence-toggle-btn {
    background: var(--hud-surface-dark-soft);
    border: 1px solid var(--hud-border);
    color: var(--hud-accent);
    padding: 6px 14px;
    border-radius: 4px;
    font-size: 0.74rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    transition: all 0.15s ease;
  }
  .evidence-toggle-btn:hover { background: var(--hud-chip-bg); color: var(--hud-text-primary); }
  .evidence-drawer { margin-top: 10px; background: var(--hud-surface-dark-strong); border: 1px solid var(--hud-border); border-radius: 6px; padding: 12px; }
  .evidence-header { display: flex; justify-content: space-between; font-size: 0.68rem; color: var(--hud-text-dim); margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid var(--hud-divider); }
  .records-table-container { max-height: 240px; overflow-y: auto; }
  .records-table { width: 100%; border-collapse: collapse; font-size: 0.7rem; color: var(--hud-text-secondary); }
  .records-table th, .records-table td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--hud-divider); }
  .records-table th { color: var(--hud-text-dim); font-weight: 600; background: var(--hud-surface-dark-soft); }
  .status-pill { padding: 1px 4px; border-radius: 2px; font-size: 0.6rem; }
  .status-available { background: var(--hud-success-soft); color: var(--hud-success); }
  .status-suppressed { background: var(--channel-launch-soft); color: var(--hud-warning); }
  .status-unavailable { background: var(--hud-danger-soft); color: var(--hud-danger); }
  .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
</style>
