<script lang="ts">
  import { onDestroy } from 'svelte';
  import { runtimeClock } from '../../runtimeClock.js';

  let currentTime = $state(new Date(runtimeClock.now()).toUTCString());
  let timer: ReturnType<typeof setInterval> | null = null;

  if (typeof window !== 'undefined') {
    timer = setInterval(() => {
      currentTime = new Date(runtimeClock.now()).toUTCString();
    }, 1000);
  }

  onDestroy(() => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  });

  const economicModules = [
    {
      id: 'phase-8',
      phase: 'Phase 8',
      title: 'Economic R0: Foundation & Core Contracts',
      badge: 'CORE CONTRACTS',
      status: 'PLANNED',
      statusReason: 'Phase 8 implementation planned. Contracts, schemas, and deterministic fixtures pending.',
      sources: ['Discriminated Geography', 'Economic Estimates', 'DataProvenance', 'BusinessContext Preview'],
      metrics: [
        { label: 'SCHEMA VALIDATION', value: 'STRICT ZOD' },
        { label: 'FIXTURES MODE', value: 'SEED ONLY' },
        { label: 'NETWORK ACCESS', value: 'DENIED' },
      ],
    },
    {
      id: 'phase-9',
      phase: 'Phase 9',
      title: 'Economic R1: Market & Business Footprint',
      badge: 'CENSUS ACS / CBP / ZBP',
      status: 'PLANNED',
      statusReason: 'Phase 9 implementation planned. Census 5-Year ACS and County/ZIP Business Patterns pending.',
      sources: ['US Census ACS 5-Year', 'Census CBP', 'Census ZBP', 'OSM Boundaries'],
      metrics: [
        { label: 'ESTIMATES TYPE', value: 'DISCLOSED / SUPPRESSED' },
        { label: 'PROVENANCE', value: 'MANDATORY' },
        { label: 'VINTAGE', value: 'MULTI-YEAR' },
      ],
    },
    {
      id: 'phase-10',
      phase: 'Phase 10',
      title: 'Economic R2: Workforce & Labor Dynamics',
      badge: 'BLS OEWS / LAU',
      status: 'PLANNED',
      statusReason: 'Phase 10 implementation planned. Bureau of Labor Statistics OEWS and LAU series pending.',
      sources: ['BLS OEWS', 'BLS LAU', 'Area Occupation Matrix'],
      metrics: [
        { label: 'WAGE BENCHMARK', value: 'PERCENTILE HOURLY/ANNUAL' },
        { label: 'EMPLOYMENT SIGNAL', value: 'AREA STATISTICAL' },
        { label: 'PII EXPOSURE', value: 'ZERO' },
      ],
    },
    {
      id: 'phase-11',
      phase: 'Phase 11',
      title: 'Economic R3: Risk, Resilience & Accessibility',
      badge: 'FEMA NRI / NFHL',
      status: 'PLANNED',
      statusReason: 'Phase 11 implementation planned. FEMA National Risk Index and Flood Hazard Layer pending.',
      sources: ['FEMA NRI Hazard Ratings', 'FEMA NFHL Vector Layers', 'Resilience Scores'],
      metrics: [
        { label: 'HAZARD RATING', value: 'EAL / SOVI RATINGS' },
        { label: 'COMMUNITY RESILIENCE', value: 'HVRA INDEX' },
        { label: 'FLOOD BOUNDARY', value: '100-YR / 500-YR' },
      ],
    },
  ];
</script>

<div class="intelligence-layout" id="intelligence-view">
  <!-- Header Card -->
  <header class="intel-header">
    <div class="hud-title-card">
      <div class="title-row">
        <h1 id="app-title">AI-Tadpole-Eye-View</h1>
        <span class="version-badge">ECONOMIC INTELLIGENCE</span>
        <nav class="hud-nav" aria-label="Main Navigation">
          <a href="#/" id="nav-link-globe" class="nav-btn" title="Navigate to Tactical Globe">
            <span class="nav-icon">🌐</span> Tactical Globe
          </a>
          <a href="#/intelligence" id="nav-link-intelligence" class="nav-btn active" title="Current: Economic Intelligence">
            <span class="nav-icon">📈</span> Intelligence
          </a>
        </nav>
      </div>
      <div id="app-status" class="hud-status">
        <span class="status-indicator"></span>
        <span class="status-text">INTELLIGENCE SURFACE ACTIVE (LOCAL SEED)</span>
        <span class="divider">|</span>
        <span class="clock-display">{currentTime}</span>
      </div>
    </div>

    <!-- Tenant & Governance Context -->
    <div class="tenant-governance-card">
      <div class="context-row">
        <span class="context-label">TENANT</span>
        <span class="context-value mono" id="tenant-id-display">tenant_default_local</span>
      </div>
      <div class="context-row">
        <span class="context-label">ROLE</span>
        <span class="context-value mono" id="tenant-role-display">operator</span>
      </div>
      <div class="context-row">
        <span class="context-label">GOVERNANCE</span>
        <span class="context-value badge-active mono">STASIS_INACTIVE</span>
      </div>
    </div>
  </header>

  <!-- Main Scrollable Intelligence Surface -->
  <main class="intel-content">
    <!-- Cesium Decoupling Telemetry Banner -->
    <section class="telemetry-banner" aria-label="Cesium Decoupling Telemetry">
      <div class="banner-title-col">
        <div class="banner-badge">RUNTIME DECOUPLING</div>
        <div class="banner-heading">Cesium Engine Not Downloaded / Zero WebGL Footprint</div>
      </div>
      <div class="metrics-grid">
        <div class="telemetry-metric">
          <span class="metric-label">CESIUM ENGINE</span>
          <span class="metric-value metric-inactive mono" id="cesium-status-metric">DECOUPLED (0 MB)</span>
        </div>
        <div class="telemetry-metric">
          <span class="metric-label">WEBGL CONTEXTS</span>
          <span class="metric-value mono" id="webgl-context-metric">0 ACTIVE</span>
        </div>
        <div class="telemetry-metric">
          <span class="metric-label">ESTIMATED SPEND</span>
          <span class="metric-value metric-accent mono" id="estimated-spend-metric">$0.00 / $10.00</span>
        </div>
        <div class="telemetry-metric">
          <span class="metric-label">PROVIDER MODE</span>
          <span class="metric-value mono" id="provider-mode-metric">SEED FIXTURES</span>
        </div>
      </div>
    </section>

    <!-- Economic Domain Modules Section -->
    <section class="modules-section" aria-label="Economic Intelligence Roadmap">
      <div class="section-header">
        <h2 class="section-title">Economic Intelligence Modules (Roadmap Phases 8–11)</h2>
        <span class="section-subtitle">Deterministic economic analytics, demographic profiles, and labor market signals.</span>
      </div>

      <div class="cards-grid">
        {#each economicModules as mod (mod.id)}
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
        {/each}
      </div>
    </section>
  </main>

  <!-- Mandatory OpenStreetMap Attribution & Status -->
  <footer id="osm-attribution" class="intel-footer">
    <div class="footer-left">
      Map data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors
      <span class="divider">|</span>
      <span>GEV v2 Industrial OSINT &amp; Economic Intelligence</span>
    </div>
    <div class="footer-right mono">
      <span>ROUTE: /#/intelligence</span>
      <span class="divider">|</span>
      <span>BUNDLE DELTA: &le; 15 KB GZIP</span>
    </div>
  </footer>
</div>

<style>
  .intelligence-layout {
    position: relative;
    width: 100vw;
    height: 100vh;
    overflow-x: hidden;
    overflow-y: auto;
    background-color: var(--hud-surface-dark);
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    padding: 16px 20px 48px 20px;
    gap: 20px;
    color: var(--hud-text-primary);
  }

  /* Header Card */
  .intel-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    flex-wrap: wrap;
    z-index: 10;
  }

  .hud-title-card {
    background: var(--hud-panel-bg);
    backdrop-filter: blur(12px);
    border: 1px solid var(--hud-border);
    border-radius: 8px;
    padding: 12px 18px;
    box-shadow: 0 4px 20px var(--hud-shadow-medium);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  h1#app-title {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--hud-text-primary);
  }

  .version-badge {
    background: var(--hud-chip-bg-strong);
    border: 1px solid var(--hud-accent-border);
    color: var(--hud-accent);
    font-size: 0.65rem;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 4px;
    letter-spacing: 0.08em;
  }

  .hud-nav {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--hud-surface-dark-soft);
    padding: 3px 4px;
    border-radius: 6px;
    border: 1px solid var(--hud-border-muted);
  }

  .nav-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--hud-text-secondary);
    text-decoration: none;
    transition: all 0.15s ease-in-out;
    cursor: pointer;
  }

  .nav-btn:hover {
    color: var(--hud-text-primary);
    background: var(--hud-chip-bg);
    border-color: var(--hud-border);
  }

  .nav-btn.active {
    background: var(--hud-accent-selected);
    color: var(--hud-accent);
    border-color: var(--hud-accent-border);
    box-shadow: 0 0 10px rgba(56, 189, 248, 0.25);
  }

  .nav-icon {
    font-size: 0.85rem;
  }

  .hud-status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.75rem;
    color: var(--hud-text-secondary);
  }

  .status-indicator {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--hud-success-signal);
    box-shadow: 0 0 8px var(--hud-success-signal);
  }

  .divider {
    color: var(--hud-divider);
    font-weight: 300;
  }

  .clock-display {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.72rem;
    color: var(--hud-text-mid);
  }

  /* Tenant Governance Card */
  .tenant-governance-card {
    background: var(--hud-panel-bg);
    backdrop-filter: blur(12px);
    border: 1px solid var(--hud-border);
    border-radius: 8px;
    padding: 10px 16px;
    display: flex;
    align-items: center;
    gap: 16px;
    box-shadow: 0 4px 20px var(--hud-shadow-medium);
  }

  .context-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .context-label {
    font-size: 0.62rem;
    font-weight: 700;
    color: var(--hud-text-dim);
    letter-spacing: 0.06em;
  }

  .context-value {
    font-size: 0.75rem;
    color: var(--hud-text-data);
    font-weight: 500;
  }

  .badge-active {
    color: var(--hud-success);
  }

  /* Content */
  .intel-content {
    display: flex;
    flex-direction: column;
    gap: 24px;
    flex: 1;
    z-index: 5;
  }

  /* Telemetry Banner */
  .telemetry-banner {
    background: var(--hud-panel-bg-raised);
    backdrop-filter: blur(12px);
    border: 1px solid var(--hud-border-strong);
    border-radius: 8px;
    padding: 16px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 20px;
    flex-wrap: wrap;
    box-shadow: 0 4px 20px var(--hud-shadow-medium);
  }

  .banner-title-col {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .banner-badge {
    align-self: flex-start;
    font-size: 0.65rem;
    font-weight: 700;
    color: var(--hud-accent);
    background: var(--hud-accent-faint);
    border: 1px solid var(--hud-accent-border);
    padding: 2px 8px;
    border-radius: 4px;
    letter-spacing: 0.08em;
  }

  .banner-heading {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--hud-text-primary);
  }

  .metrics-grid {
    display: flex;
    align-items: center;
    gap: 20px;
    flex-wrap: wrap;
  }

  .telemetry-metric {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .metric-label {
    font-size: 0.62rem;
    color: var(--hud-text-dim);
    font-weight: 700;
    letter-spacing: 0.06em;
  }

  .metric-value {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--hud-text-panel);
  }

  .metric-inactive {
    color: var(--hud-text-dim);
  }

  .metric-accent {
    color: var(--hud-accent);
  }

  /* Modules Section */
  .modules-section {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .section-header {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .section-title {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--hud-text-primary);
  }

  .section-subtitle {
    font-size: 0.78rem;
    color: var(--hud-text-secondary);
  }

  .cards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 16px;
  }

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

  /* Empty state box */
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

  /* Footer */
  .intel-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: var(--hud-panel-bg-muted);
    backdrop-filter: blur(8px);
    border: 1px solid var(--hud-chip-border);
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 0.7rem;
    color: var(--hud-text-secondary);
    flex-wrap: wrap;
    gap: 8px;
    margin-top: auto;
  }

  .intel-footer a {
    color: var(--hud-accent);
    text-decoration: none;
  }

  .intel-footer a:hover {
    text-decoration: underline;
  }

  .footer-left,
  .footer-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .mono {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }
</style>
