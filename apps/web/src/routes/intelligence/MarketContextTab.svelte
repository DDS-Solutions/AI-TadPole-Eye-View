<script lang="ts">
  import type { AnalyzeMarketContextOutput } from '@gev/contracts';
  import { formatEstimate } from './formatters.js';

  interface Props {
    result: AnalyzeMarketContextOutput;
  }

  const { result }: Props = $props();

  let showEvidenceDrawer = $state(false);
</script>

<div class="market-context-tab" id="market-context-tab-content">
  {#if result.disagreement_state.has_disagreements}
    <div class="disagreement-banner" id="market-inspector-disagreement-banner">
      <div class="disagreement-header">
        <span class="badge-disagreement">UNRESOLVED_PRESERVED</span>
        <span class="disagreement-title">Cross-Source Divergence Detected</span>
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
    <!-- Demographics Card -->
    <div class="metric-card" id="market-demographics-card">
      <div class="card-title-row">
        <span class="card-icon">👥</span>
        <span class="card-title">Demographics (Census ACS 5-Year)</span>
      </div>
      <div class="metric-row">
        <span class="metric-name">Total Population</span>
        <span class="metric-val mono" id="metric-total-population">
          {formatEstimate(result.demographics.total_population)}
        </span>
      </div>
      <div class="metric-row">
        <span class="metric-name">Median Household Income</span>
        <span class="metric-val mono" id="metric-median-income">
          {formatEstimate(result.demographics.median_household_income, '$')}
        </span>
      </div>
      <div class="metric-row">
        <span class="metric-name">Foreign-Born Population</span>
        <span class="metric-val mono" id="metric-foreign-born">
          {formatEstimate(result.evidence_bundle.records.find((r) => r.variable_name === 'DP02_0093E' || r.metric_id.includes('foreign-born'))?.estimate)}
        </span>
      </div>
      <div class="statutory-note">
        Statutory definition: U.S. Census Bureau ACS 5-Year (includes naturalized citizens and non-citizens)
      </div>
    </div>

    <!-- Business Activity Card -->
    <div class="metric-card" id="market-business-card">
      <div class="card-title-row">
        <span class="card-icon">🏢</span>
        <span class="card-title">Business Activity (Census CBP/ZBP)</span>
      </div>
      <div class="metric-row">
        <span class="metric-name">Total Establishments</span>
        <span class="metric-val mono" id="metric-total-establishments">
          {formatEstimate(result.business_activity.total_establishments)}
        </span>
      </div>
      <div class="metric-row">
        <span class="metric-name">Paid Employment</span>
        <span class="metric-val mono" id="metric-paid-employment">
          {formatEstimate(result.business_activity.paid_employment)}
        </span>
      </div>
      <div class="metric-row">
        <span class="metric-name">Annual Payroll</span>
        <span class="metric-val mono" id="metric-annual-payroll">
          {formatEstimate(result.business_activity.annual_payroll_usd_thousands, '$')}
        </span>
      </div>
      <div class="metric-row">
        <span class="metric-name">Avg Wage / Employee</span>
        <span class="metric-val mono" id="metric-average-wage">
          {formatEstimate(result.business_activity.average_annual_wage_usd, '$')}
        </span>
      </div>
    </div>

    <!-- Commercial Footprint Card -->
    <div class="metric-card" id="market-commercial-card">
      <div class="card-title-row">
        <span class="card-icon">📍</span>
        <span class="card-title">Commercial Footprint (OSM)</span>
      </div>
      <div class="metric-row">
        <span class="metric-name">Total Commercial POIs</span>
        <span class="metric-val mono" id="metric-total-pois">
          {formatEstimate(result.commercial_footprint.commercial_poi_count)}
        </span>
      </div>
      <div class="metric-row">
        <span class="metric-name">POI Density</span>
        <span class="metric-val mono" id="metric-poi-density">
          {formatEstimate(result.commercial_footprint.commercial_density_per_km2)}
        </span>
      </div>
      <div class="attribution-note" id="osm-poi-attribution">
        © OpenStreetMap contributors (ODbL 1.0)
      </div>
    </div>
  </div>

  <!-- Evidence Inspection Drawer -->
  <div class="evidence-section">
    <button
      id="market-inspector-evidence-toggle"
      class="evidence-toggle-btn"
      onclick={() => (showEvidenceDrawer = !showEvidenceDrawer)}
    >
      {showEvidenceDrawer ? '▼ HIDE EVIDENCE RECORDS' : `▶ INSPECT EVIDENCE RECORDS (${result.evidence_bundle.records.length})`}
    </button>

    {#if showEvidenceDrawer}
      <div class="evidence-drawer" id="market-evidence-drawer">
        <table class="evidence-table" id="market-evidence-table">
          <thead>
            <tr>
              <th>SOURCE</th>
              <th>METRIC / VARIABLE</th>
              <th>STATUS</th>
              <th>VALUE / NOISE</th>
              <th>VINTAGE &amp; PROVENANCE</th>
            </tr>
          </thead>
          <tbody>
            {#each result.evidence_bundle.records as record (record.evidence_id)}
              <tr>
                <td class="mono font-semibold">{record.source_id}</td>
                <td>{record.label || record.metric_id} <span class="dim mono">({record.variable_name})</span></td>
                <td><span class="status-pill status-{record.estimate.status} mono">{record.estimate.status.toUpperCase()}</span></td>
                <td class="mono">{formatEstimate(record.estimate)}</td>
                <td class="mono dim">{record.provenance.vintage} | {record.provenance.license}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>

<style>
  .market-context-tab {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .disagreement-banner {
    background: var(--channel-launch-soft);
    border: 1px solid var(--hud-warning);
    border-radius: 6px;
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .disagreement-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .badge-disagreement {
    background: var(--hud-warning);
    color: var(--hud-surface-dark);
    font-size: 0.62rem;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 3px;
  }

  .disagreement-title {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--hud-warning);
  }

  .disagreement-item {
    display: flex;
    gap: 8px;
    font-size: 0.72rem;
    color: var(--hud-text-secondary);
  }

  .metrics-cards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 14px;
  }

  .metric-card {
    background: var(--hud-panel-bg);
    border: 1px solid var(--hud-border);
    border-radius: 6px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .card-title-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--hud-text-panel);
    border-bottom: 1px solid var(--hud-divider);
    padding-bottom: 6px;
  }

  .metric-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 0.76rem;
  }

  .metric-name {
    color: var(--hud-text-secondary);
  }

  .metric-val {
    color: var(--hud-text-primary);
    font-weight: 600;
  }

  .statutory-note,
  .attribution-note {
    margin-top: 4px;
    font-size: 0.64rem;
    color: var(--hud-text-dim);
    line-height: 1.3;
  }

  .evidence-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .evidence-toggle-btn {
    align-self: flex-start;
    background: var(--hud-surface-dark-soft);
    border: 1px solid var(--hud-border);
    color: var(--hud-accent);
    padding: 5px 12px;
    border-radius: 4px;
    font-size: 0.72rem;
    cursor: pointer;
  }

  .evidence-drawer {
    overflow-x: auto;
    border: 1px solid var(--hud-border);
    border-radius: 6px;
    background: var(--hud-panel-bg);
  }

  .evidence-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.72rem;
  }

  .evidence-table th {
    background: var(--hud-surface-dark-strong);
    padding: 8px 10px;
    text-align: left;
    color: var(--hud-text-dim);
    font-size: 0.65rem;
    letter-spacing: 0.05em;
    border-bottom: 1px solid var(--hud-border-strong);
  }

  .evidence-table td {
    padding: 6px 10px;
    border-bottom: 1px solid var(--hud-divider);
  }

  .status-pill {
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 0.62rem;
  }

  .status-available {
    background: var(--hud-success-soft);
    color: var(--hud-success);
  }

  .status-suppressed {
    background: var(--channel-launch-soft);
    color: var(--hud-warning);
  }

  .status-unavailable {
    background: var(--hud-danger-soft);
    color: var(--hud-danger);
  }

  .mono {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }

  .dim {
    color: var(--hud-text-dim);
  }

  .font-semibold {
    font-weight: 600;
  }
</style>
