<script lang="ts">
  import type { EconomicEstimate, SiteRiskAssessmentResult } from '@gev/contracts';
  import { formatEstimate } from './formatters.js';

  interface Props {
    result: SiteRiskAssessmentResult;
  }

  const { result }: Props = $props();

  let showSourcesDrawer = $state(false);

  function formatWithUnit(est: EconomicEstimate, unit: string): string {
    const formatted = formatEstimate(est);
    return est.status === 'available' ? `${formatted} ${unit}` : formatted;
  }
</script>

<div class="site-risk-tab" id="site-risk-tab-content">
  <!-- Mandatory Non-Definitive Screening Disclaimer Banner -->
  <div class="screening-disclaimer-banner" id="site-risk-disclaimer-banner">
    <div class="signal-header">
      <span class="badge-screening">PRELIMINARY SCREENING SIGNAL — NOT DEFINITIVE ADVICE</span>
      <span class="signal-title">Multi-Source Risk, Resilience &amp; Accessibility Context</span>
    </div>
    <div class="signal-body">{result.advisory_disclaimer}</div>
  </div>

  <!-- Overall Screening Summary -->
  <div class="summary-strip" id="site-risk-summary-strip">
    <div class="summary-cell">
      <span class="summary-label">SCREENING SCORE (0–100)</span>
      <span class="summary-val mono" id="metric-site-risk-score">
        {formatEstimate(result.overall_screening_score)}
      </span>
    </div>
    <div class="summary-cell">
      <span class="summary-label">SCREENING TIER</span>
      <span class="badge-tier mono" id="metric-site-risk-tier">
        {result.screening_tier.toUpperCase()}
      </span>
    </div>
    <div class="summary-cell">
      <span class="summary-label">LONG-TERM SIGNALS</span>
      <span class="summary-val mono" id="metric-site-risk-signals">
        {result.long_term_hazards.available_signal_count}
      </span>
    </div>
    <div class="summary-cell">
      <span class="summary-label">DATA GAPS</span>
      <span class="summary-val mono" id="metric-site-risk-gaps">
        {result.data_gaps.length}
      </span>
    </div>
  </div>

  <div class="metrics-cards-grid">
    <!-- Long-Term Structural Hazards Card (Strictly Distinct from Current Alerts) -->
    <div class="metric-card" id="site-risk-long-term-card">
      <div class="card-title-row">
        <span class="card-title">Long-Term Structural Hazards</span>
        <span class="badge-horizon mono">LONG_TERM_STRUCTURAL_HAZARD</span>
      </div>
      <div class="metric-row">
        <span class="metric-name">FEMA NRI Composite Score</span>
        <span class="metric-val mono" id="metric-fema-nri-score">
          {formatEstimate(result.long_term_hazards.fema_nri_composite_score)}
        </span>
      </div>
      <div class="metric-row">
        <span class="metric-name">FEMA NRI Risk Rating</span>
        <span class="metric-val mono" id="metric-fema-nri-rating">
          {result.long_term_hazards.fema_nri_rating}
        </span>
      </div>
      <div class="metric-row">
        <span class="metric-name">FEMA NFHL Flood Category</span>
        <span class="metric-val mono" id="metric-fema-nfhl-cat">
          {result.long_term_hazards.fema_nfhl_risk_category.toUpperCase()}
        </span>
      </div>
      <div class="metric-row">
        <span class="metric-name">In Special Flood Hazard Area</span>
        <span class="metric-val mono" id="metric-fema-in-sfha">
          {result.long_term_hazards.in_sfha === null ? '[UNAVAILABLE]' : result.long_term_hazards.in_sfha ? 'YES (SFHA)' : 'NO'}
        </span>
      </div>
      <div class="metric-row">
        <span class="metric-name">USGS 3DEP Elevation (NAVD88)</span>
        <span class="metric-val mono" id="metric-usgs-elevation">
          {formatWithUnit(result.long_term_hazards.elevation_meters, 'm')}
        </span>
      </div>
      <div class="metric-row">
        <span class="metric-name">EPA AQS Historical Flags</span>
        <span class="metric-val mono" id="metric-epa-aqs-flags">
          {result.long_term_hazards.historical_air_exceedance_flags.length}
        </span>
      </div>
    </div>

    <!-- Current Operational Alerts Card (Strictly Distinct from Long-Term Hazards) -->
    <div class="metric-card" id="site-risk-current-alerts-card">
      <div class="card-title-row">
        <span class="card-title">Current Operational Alerts</span>
        <span class="badge-live mono">CURRENT_OPERATIONAL_ALERT</span>
      </div>
      <div class="metric-row">
        <span class="metric-name">Active Alert Count</span>
        <span class="metric-val mono" id="metric-active-alert-count">
          {result.current_operational_alerts.active_alert_count}
        </span>
      </div>
      <div class="metric-row">
        <span class="metric-name">Highest Severity</span>
        <span class="metric-val mono" id="metric-active-alert-severity">
          {result.current_operational_alerts.highest_severity.toUpperCase()}
        </span>
      </div>
      {#if result.current_operational_alerts.alert_headlines.length > 0}
        <ul class="alert-list">
          {#each result.current_operational_alerts.alert_headlines as headline}
            <li class="mono">{headline}</li>
          {/each}
        </ul>
      {/if}
      <div class="statutory-note">{result.current_operational_alerts.source_note}</div>
    </div>

    <!-- DOT/BTS Accessibility Context Card -->
    <div class="metric-card" id="site-risk-accessibility-card">
      <div class="card-title-row">
        <span class="card-title">DOT/BTS Accessibility Context</span>
        <span class="badge-tier mono" id="metric-bts-tier">
          {result.accessibility_context.accessibility_tier.toUpperCase()}
        </span>
      </div>
      <div class="metric-row">
        <span class="metric-name">Freight Corridor Exposure</span>
        <span class="metric-val mono" id="metric-bts-freight">
          {result.accessibility_context.freight_exposure.toUpperCase()}
        </span>
      </div>
      <div class="metric-row">
        <span class="metric-name">Nearest Interstate</span>
        <span class="metric-val mono">{formatWithUnit(result.accessibility_context.nearest_interstate_km, 'km')}</span>
      </div>
      <div class="metric-row">
        <span class="metric-name">Nearest Transit Stop</span>
        <span class="metric-val mono">{formatWithUnit(result.accessibility_context.nearest_transit_stop_km, 'km')}</span>
      </div>
      <div class="metric-row">
        <span class="metric-name">Mean Commute Time</span>
        <span class="metric-val mono">{formatWithUnit(result.accessibility_context.commute_mean_minutes, 'min')}</span>
      </div>
    </div>
  </div>

  <!-- Explicit Source Provenance & Data Gaps Inspection Drawer -->
  <div class="evidence-section">
    <button
      class="evidence-toggle-btn"
      id="site-risk-sources-toggle"
      onclick={() => (showSourcesDrawer = !showSourcesDrawer)}
    >
      <span>{showSourcesDrawer ? '▼' : '►'}</span>
      <span>Inspect Source Product / Vintage / Geography &amp; Data Gaps ({result.source_signals.length} sources)</span>
    </button>

    {#if showSourcesDrawer}
      <div class="evidence-drawer" id="site-risk-sources-drawer">
        <table class="records-table mono">
          <thead>
            <tr>
              <th>SOURCE ID</th>
              <th>PRODUCT</th>
              <th>VINTAGE</th>
              <th>GEOGRAPHY</th>
              <th>MODE</th>
              <th>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {#each result.source_signals as sig (sig.source_id)}
              <tr>
                <td>{sig.source_id}</td>
                <td>{sig.product_name}</td>
                <td>{sig.vintage}</td>
                <td>{sig.geography.level}</td>
                <td>{sig.mode.toUpperCase()}</td>
                <td>{sig.status.toUpperCase()}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if result.data_gaps.length > 0}
          <div class="gaps-list" id="site-risk-data-gaps-list">
            <div class="gaps-title mono">EXPLICIT DATA GAPS (NON-COERCED):</div>
            <ul>
              {#each result.data_gaps as gap}
                <li>{gap}</li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .site-risk-tab { display: flex; flex-direction: column; gap: 16px; }
  .screening-disclaimer-banner {
    background: var(--channel-launch-soft);
    border: 1px solid var(--hud-warning);
    border-radius: 6px;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .signal-header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .badge-screening {
    background: var(--hud-warning);
    color: var(--hud-surface-dark);
    font-size: 0.62rem;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 3px;
  }
  .signal-title { color: var(--hud-text-primary); font-weight: 600; font-size: 0.8rem; }
  .signal-body { color: var(--hud-text-secondary); font-size: 0.74rem; line-height: 1.4; }
  .summary-strip {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
    background: var(--hud-panel-bg);
    border: 1px solid var(--hud-border);
    border-radius: 6px;
    padding: 12px 16px;
  }
  .summary-cell { display: flex; flex-direction: column; gap: 4px; }
  .summary-label { font-size: 0.64rem; color: var(--hud-text-dim); letter-spacing: 0.04em; }
  .summary-val { font-size: 0.92rem; color: var(--hud-accent); font-weight: 700; }
  .metrics-cards-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
  .metric-card {
    background: var(--hud-panel-bg);
    border: 1px solid var(--hud-border);
    border-radius: 6px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .card-title-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; border-bottom: 1px solid var(--hud-divider); padding-bottom: 6px; }
  .card-title { font-size: 0.84rem; font-weight: 600; color: var(--hud-text-panel); }
  .badge-horizon { background: var(--hud-accent-selected); color: var(--hud-accent); font-size: 0.58rem; padding: 2px 6px; border-radius: 3px; }
  .badge-live { background: var(--hud-danger-soft); color: var(--hud-danger); font-size: 0.58rem; padding: 2px 6px; border-radius: 3px; }
  .badge-tier { background: var(--hud-accent-selected); color: var(--hud-accent); font-size: 0.62rem; padding: 2px 6px; border-radius: 3px; width: fit-content; }
  .metric-row { display: flex; justify-content: space-between; align-items: center; font-size: 0.76rem; padding: 2px 0; }
  .metric-name { color: var(--hud-text-secondary); }
  .metric-val { color: var(--hud-text-primary); font-weight: 500; }
  .statutory-note { font-size: 0.68rem; color: var(--hud-text-dim); margin-top: 4px; line-height: 1.35; }
  .alert-list { margin: 4px 0 0 16px; padding: 0; font-size: 0.7rem; color: var(--hud-warning); }
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
  }
  .evidence-drawer { margin-top: 10px; background: var(--hud-surface-dark-strong); border: 1px solid var(--hud-border); border-radius: 6px; padding: 12px; overflow-x: auto; }
  .records-table { width: 100%; border-collapse: collapse; font-size: 0.7rem; color: var(--hud-text-secondary); }
  .records-table th, .records-table td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--hud-divider); }
  .records-table th { color: var(--hud-text-dim); background: var(--hud-surface-dark-soft); }
  .gaps-list { margin-top: 10px; font-size: 0.72rem; color: var(--hud-text-secondary); }
  .gaps-title { color: var(--hud-warning); font-weight: 700; margin-bottom: 4px; }
  .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
</style>

