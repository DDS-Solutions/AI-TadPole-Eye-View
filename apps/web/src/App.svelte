<script lang="ts">
  import { onMount, type Component } from 'svelte';

  type RouteKey = 'globe' | 'intelligence';

  function getRoute(): RouteKey {
    if (typeof window === 'undefined') return 'globe';
    const hash = window.location.hash;
    if (hash.startsWith('#/intelligence')) {
      return 'intelligence';
    }
    return 'globe';
  }

  let currentRoute = $state<RouteKey>(getRoute());
  let GlobeComponent = $state<Component | null>(null);
  let IntelligenceComponent = $state<Component | null>(null);
  let isLoading = $state(true);
  let loadError = $state<string | null>(null);

  async function syncRouteComponent(route: RouteKey) {
    loadError = null;
    if (route === 'intelligence') {
      if (!IntelligenceComponent) {
        try {
          isLoading = true;
          const mod = await import('./routes/intelligence/IntelligenceRoute.svelte');
          IntelligenceComponent = mod.default;
        } catch (err) {
          loadError = err instanceof Error ? err.message : String(err);
        } finally {
          isLoading = false;
        }
      }
    } else {
      if (!GlobeComponent) {
        try {
          isLoading = true;
          const mod = await import('./routes/GlobeRoute.svelte');
          GlobeComponent = mod.default;
        } catch (err) {
          loadError = err instanceof Error ? err.message : String(err);
        } finally {
          isLoading = false;
        }
      }
    }
  }

  // Start loading the initial route immediately
  syncRouteComponent(getRoute());

  $effect(() => {
    syncRouteComponent(currentRoute);
  });

  onMount(() => {
    const onHashChange = () => {
      currentRoute = getRoute();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  });
</script>

{#if loadError}
  <div class="route-error" role="alert">
    <h2>Failed to load view</h2>
    <p>{loadError}</p>
    <a href="#/" class="error-home-link">Return to Tactical Globe</a>
  </div>
{:else if currentRoute === 'intelligence'}
  {#if IntelligenceComponent}
    <IntelligenceComponent />
  {:else if isLoading}
    <div class="route-loading" aria-live="polite">
      <div class="loading-spinner"></div>
      <span>Loading Economic Intelligence Surface...</span>
    </div>
  {/if}
{:else}
  {#if GlobeComponent}
    <GlobeComponent />
  {:else if isLoading}
    <div class="route-loading" aria-live="polite">
      <div class="loading-spinner"></div>
      <span>Initializing Tactical Globe Console...</span>
    </div>
  {/if}
{/if}

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
    width: 100vw;
    max-width: 100vw;
    height: 100vh;
    overflow: hidden;
    background-color: var(--hud-surface-dark);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    color: var(--hud-text-primary);
  }

  .route-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    width: 100vw;
    height: 100vh;
    background: var(--hud-surface-dark);
    color: var(--hud-text-secondary);
    font-size: 0.85rem;
    font-weight: 500;
  }

  .loading-spinner {
    width: 28px;
    height: 28px;
    border: 2px solid var(--hud-chip-border);
    border-top-color: var(--hud-accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .route-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    width: 100vw;
    height: 100vh;
    background: var(--hud-surface-dark);
    color: var(--hud-danger);
    padding: 20px;
    box-sizing: border-box;
    text-align: center;
  }

  .error-home-link {
    color: var(--hud-accent);
    font-size: 0.85rem;
    text-decoration: none;
    padding: 6px 12px;
    border: 1px solid var(--hud-accent-border);
    border-radius: 4px;
    background: var(--hud-accent-faint);
  }

  .error-home-link:hover {
    background: var(--hud-accent-selected);
  }
</style>
