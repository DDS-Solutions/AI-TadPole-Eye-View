<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    AnalyzeCompetitionOutput,
    AnalyzeMarketContextOutput,
    AnalyzeWorkforceContextOutput,
    CompareLocationsOutput,
    EconomicGeography,
  } from '@gev/contracts';
  import MarketContextTab from './MarketContextTab.svelte';
  import LocationComparisonTab from './LocationComparisonTab.svelte';
  import WorkforceTab from './WorkforceTab.svelte';

  type TabId = 'market' | 'competition' | 'comparison' | 'workforce';

  const GEOGRAPHY_PRESETS: Array<{ id: string; label: string; geo: EconomicGeography }> = [
    {
      id: 'travis-county',
      label: 'Travis County, TX (County)',
      geo: { level: 'county', county_fips: '48453', state_fips: '48', name: 'Travis County, TX' },
    },
    {
      id: 'austin-city',
      label: 'Austin City, TX (Place)',
      geo: { level: 'place', place_fips: '4805000', name: 'Austin city, TX' },
    },
    {
      id: 'downtown-78701',
      label: 'Downtown Austin (ZCTA 78701)',
      geo: { level: 'zcta', zcta: '78701', name: 'ZCTA 78701' },
    },
  ];

  const NAICS_PRESETS = [
    { code: '722511', title: 'Full-Service Restaurants' },
    { code: '541511', title: 'Custom Computer Programming Services' },
    { code: '44-45', title: 'Retail Trade' },
  ];

  const SOC_PRESETS = [
    { code: '15-1252', title: 'Software Developers' },
    { code: '29-1141', title: 'Registered Nurses' },
    { code: '35-2014', title: 'Cooks, Restaurant' },
    { code: '00-0000', title: 'All Occupations' },
  ];

  let selectedGeoId = $state('travis-county');
  let selectedNaicsCode = $state('722511');
  let selectedSocCode = $state('15-1252');
  let activeTab = $state<TabId>('market');

  let loading = $state(false);
  let errorMessage = $state<string | null>(null);

  let marketResult = $state<AnalyzeMarketContextOutput | null>(null);
  let competitionResult = $state<AnalyzeCompetitionOutput | null>(null);
  let comparisonResult = $state<CompareLocationsOutput | null>(null);
  let workforceResult = $state<AnalyzeWorkforceContextOutput | null>(null);

  const currentGeo = $derived(
    GEOGRAPHY_PRESETS.find((p) => p.id === selectedGeoId)?.geo ?? GEOGRAPHY_PRESETS[0].geo
  );
  const currentNaics = $derived(
    NAICS_PRESETS.find((p) => p.code === selectedNaicsCode) ?? NAICS_PRESETS[0]
  );
  const currentSoc = $derived(
    SOC_PRESETS.find((s) => s.code === selectedSocCode) ?? SOC_PRESETS[0]
  );

  async function postEconomic<T>(endpoint: string, payload: unknown): Promise<T> {
    const res = await fetch(`/api/economic/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `${endpoint} failed (${res.status})`);
    }
    return res.json();
  }

  async function executeAnalysis() {
    loading = true;
    errorMessage = null;

    try {
      if (activeTab === 'market') {
        marketResult = await postEconomic<AnalyzeMarketContextOutput>('market-analysis', {
          tenant_id: 'tenant-local',
          target_geography: currentGeo,
          naics_code: currentNaics.code,
          industry_title: currentNaics.title,
          acs_evidence: [],
          cbp_evidence: [],
          osm_evidence: [],
        });
      } else if (activeTab === 'competition') {
        competitionResult = await postEconomic<AnalyzeCompetitionOutput>('competition-analysis', {
          tenant_id: 'tenant-local',
          target_geography: currentGeo,
          naics_code: currentNaics.code,
          industry_title: currentNaics.title,
          cbp_evidence: [],
        });
      } else if (activeTab === 'comparison') {
        comparisonResult = await postEconomic<CompareLocationsOutput>('location-comparison', {
          tenant_id: 'tenant-local',
          naics_code: currentNaics.code,
          industry_title: currentNaics.title,
          benchmark_location_key: 'loc-0',
          locations: GEOGRAPHY_PRESETS.map((p, idx) => ({
            location_key: `loc-${idx}`,
            label: p.label,
            geography: p.geo,
            acs_evidence: [],
            cbp_evidence: [],
          })),
        });
      } else if (activeTab === 'workforce') {
        workforceResult = await postEconomic<AnalyzeWorkforceContextOutput>('workforce-analysis', {
          tenant_id: 'tenant-local',
          target_geography: currentGeo,
          soc_code: currentSoc.code,
          occupation_title: currentSoc.title,
          oews_evidence: [],
          lau_evidence: [],
        });
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Analysis failed';
    } finally {
      loading = false;
    }
  }

  function handleTabChange(tab: TabId) {
    activeTab = tab;
    executeAnalysis();
  }

  onMount(() => {
    executeAnalysis();
  });
</script>

<div class="market-inspector-container" id="market-analysis-inspector">
  <div class="inspector-header">
    <div class="header-left">
      <span class="chip-badge">PHASE 9 &amp; 10 OPERATOR HUD</span>
      <h3 class="inspector-title" id="market-inspector-title">Market &amp; Business Footprint Inspector</h3>
      <span class="inspector-subtitle">Governed demographic, establishment, and commercial footprint telemetry</span>
    </div>
    <div class="tab-controls">
      <button
        id="market-tab-context"
        class="tab-btn"
        class:active={activeTab === 'market'}
        onclick={() => handleTabChange('market')}
      >
        Market Context
      </button>
      <button
        id="market-tab-competition"
        class="tab-btn"
        class:active={activeTab === 'competition'}
        onclick={() => handleTabChange('competition')}
      >
        Competition &amp; HHI
      </button>
      <button
        id="market-tab-comparison"
        class="tab-btn"
        class:active={activeTab === 'comparison'}
        onclick={() => handleTabChange('comparison')}
      >
        Location Comparison
      </button>
      <button
        id="tab-btn-workforce"
        class="tab-btn"
        class:active={activeTab === 'workforce'}
        onclick={() => handleTabChange('workforce')}
      >
        Workforce &amp; Wages
      </button>
    </div>
  </div>

  <div class="filter-bar">
    <div class="filter-group">
      <label for="market-inspector-geo-select">GEOGRAPHY PRESET</label>
      <select
        id="market-inspector-geo-select"
        bind:value={selectedGeoId}
        onchange={executeAnalysis}
      >
        {#each GEOGRAPHY_PRESETS as preset (preset.id)}
          <option value={preset.id}>{preset.label}</option>
        {/each}
      </select>
    </div>

    {#if activeTab === 'workforce'}
      <div class="filter-group">
        <label for="workforce-inspector-soc-select">OCCUPATION / SOC</label>
        <select
          id="workforce-inspector-soc-select"
          bind:value={selectedSocCode}
          onchange={executeAnalysis}
        >
          {#each SOC_PRESETS as preset (preset.code)}
            <option value={preset.code}>{preset.code} - {preset.title}</option>
          {/each}
        </select>
      </div>
    {:else}
      <div class="filter-group">
        <label for="market-inspector-naics-select">INDUSTRY / NAICS</label>
        <select
          id="market-inspector-naics-select"
          bind:value={selectedNaicsCode}
          onchange={executeAnalysis}
        >
          {#each NAICS_PRESETS as preset (preset.code)}
            <option value={preset.code}>{preset.code} - {preset.title}</option>
          {/each}
        </select>
      </div>
    {/if}

    <button
      id="market-inspector-run-btn"
      class="run-btn"
      disabled={loading}
      onclick={executeAnalysis}
    >
      {loading ? 'CALCULATING...' : activeTab === 'workforce' ? 'RUN WORKFORCE ANALYSIS' : 'RUN MARKET ANALYSIS'}
    </button>
  </div>

  {#if errorMessage}
    <div class="error-banner" id="market-inspector-error">
      <span class="error-icon">⚠️</span>
      <span class="error-text">{errorMessage}</span>
      <button class="retry-btn" onclick={executeAnalysis}>RETRY</button>
    </div>
  {/if}

  {#if activeTab === 'market' && marketResult}
    <MarketContextTab result={marketResult} />
  {/if}

  {#if activeTab === 'competition' && competitionResult}
    <div class="metrics-cards-grid" id="market-competition-panel">
      <div class="metric-card" id="competition-hhi-card">
        <div class="card-title-row">
          <span class="card-icon">📊</span>
          <span class="card-title">Market Concentration (HHI)</span>
        </div>
        <div class="metric-row">
          <span class="metric-name">HHI Index Score</span>
          <span class="metric-val mono font-bold" id="metric-hhi-score">
            {competitionResult.concentration.hhi !== null ? competitionResult.concentration.hhi : '[UNAVAILABLE]'}
          </span>
        </div>
        <div class="metric-row">
          <span class="metric-name">Concentration Tier</span>
          <span class="metric-val mono badge-tier" id="metric-concentration-tier">
            {competitionResult.concentration.tier.toUpperCase()}
          </span>
        </div>
        <div class="metric-row">
          <span class="metric-name">Firm Count</span>
          <span class="metric-val mono" id="metric-firm-count">
            {competitionResult.concentration.firm_count.toLocaleString()}
          </span>
        </div>
        <div class="metric-row">
          <span class="metric-name">Top Firm Share</span>
          <span class="metric-val mono" id="metric-top-share">
            {competitionResult.concentration.top_share_pct.toFixed(1)}%
          </span>
        </div>
        <div class="metric-row">
          <span class="metric-name">Top 4 Share (CR4)</span>
          <span class="metric-val mono" id="metric-top4-share">
            {competitionResult.concentration.cr4_pct !== undefined
              ? `${competitionResult.concentration.cr4_pct.toFixed(1)}%`
              : '[UNAVAILABLE]'}
          </span>
        </div>
      </div>
    </div>
  {/if}

  {#if activeTab === 'comparison' && comparisonResult}
    <LocationComparisonTab result={comparisonResult} />
  {/if}

  {#if activeTab === 'workforce' && workforceResult}
    <WorkforceTab result={workforceResult} />
  {/if}
</div>

<style>
  .market-inspector-container {
    background: var(--hud-panel-bg-raised);
    backdrop-filter: blur(12px);
    border: 1px solid var(--hud-border-strong);
    border-radius: 8px;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-shadow: 0 4px 20px var(--hud-shadow-medium);
  }

  .inspector-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 12px;
  }

  .header-left {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .chip-badge {
    align-self: flex-start;
    font-size: 0.62rem;
    font-weight: 700;
    color: var(--hud-accent);
    background: var(--hud-accent-faint);
    border: 1px solid var(--hud-accent-border);
    padding: 2px 7px;
    border-radius: 4px;
    letter-spacing: 0.08em;
  }

  .inspector-title {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--hud-text-primary);
  }

  .inspector-subtitle {
    font-size: 0.76rem;
    color: var(--hud-text-secondary);
  }

  .tab-controls {
    display: flex;
    gap: 6px;
    background: var(--hud-surface-dark-soft);
    padding: 3px;
    border-radius: 6px;
    border: 1px solid var(--hud-border-muted);
  }

  .tab-btn {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 5px 12px;
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--hud-text-secondary);
    cursor: pointer;
    transition: all 0.15s ease-in-out;
  }

  .tab-btn:hover {
    color: var(--hud-text-primary);
    background: var(--hud-chip-bg);
  }

  .tab-btn.active {
    background: var(--hud-accent-selected);
    color: var(--hud-accent);
    border-color: var(--hud-accent-border);
  }

  .filter-bar {
    display: flex;
    align-items: flex-end;
    gap: 14px;
    flex-wrap: wrap;
    background: var(--hud-panel-bg);
    padding: 12px 14px;
    border-radius: 6px;
    border: 1px solid var(--hud-border);
  }

  .filter-group { display: flex; flex-direction: column; gap: 4px; }
  .filter-group label { font-size: 0.62rem; font-weight: 700; color: var(--hud-text-dim); letter-spacing: 0.06em; }
  select {
    background: var(--hud-surface-dark-strong);
    color: var(--hud-text-primary);
    border: 1px solid var(--hud-border-strong);
    padding: 6px 10px;
    border-radius: 4px;
    font-size: 0.78rem;
    outline: none;
  }
  select:focus { border-color: var(--hud-accent); }
  .run-btn {
    background: var(--hud-accent);
    color: var(--hud-surface-dark);
    border: none;
    border-radius: 4px;
    padding: 7px 16px;
    font-size: 0.76rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: filter 0.15s ease-in-out;
  }
  .run-btn:hover:not(:disabled) { filter: brightness(1.1); }
  .run-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .error-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--hud-danger-soft);
    border: 1px solid var(--hud-danger);
    padding: 8px 12px;
    border-radius: 4px;
    color: var(--hud-text-primary);
    font-size: 0.78rem;
  }
  .retry-btn {
    margin-left: auto;
    background: transparent;
    border: 1px solid var(--hud-danger);
    color: var(--hud-text-primary);
    padding: 2px 8px;
    border-radius: 3px;
    cursor: pointer;
  }
  .metrics-cards-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
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
  .metric-row { display: flex; justify-content: space-between; align-items: baseline; font-size: 0.76rem; }
  .metric-name { color: var(--hud-text-secondary); }
  .metric-val { color: var(--hud-text-primary); font-weight: 600; }
  .badge-tier { background: var(--hud-accent-selected); color: var(--hud-accent); padding: 2px 6px; border-radius: 3px; }
  .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
  .font-bold { font-weight: 700; }
</style>
