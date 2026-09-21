<script lang="ts">
  import { onDestroy } from 'svelte';
  import { runtimeClock } from '../../runtimeClock.js';
  import EconomicModuleCard from './EconomicModuleCard.svelte';
  import { economicModules } from './economicModulesData.js';
  import MarketAnalysisInspector from './MarketAnalysisInspector.svelte';

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

    <!-- Phase 9 Market & Business Footprint Inspector -->
    <section class="inspector-section" aria-label="Market and Business Footprint Inspector">
      <MarketAnalysisInspector />
    </section>

    <!-- Economic Domain Modules Section -->
    <section class="modules-section" aria-label="Economic Intelligence Roadmap">
      <div class="section-header">
        <h2 class="section-title">Economic Intelligence Modules (Roadmap Phases 8–11)</h2>
        <span class="section-subtitle">Deterministic economic analytics, demographic profiles, and labor market signals.</span>
      </div>

      <div class="cards-grid">
        {#each economicModules as mod (mod.id)}
          <EconomicModuleCard module={mod} />
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
    box-shadow: 0 0 10px var(--hud-accent-selected);
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
