import { type ProviderRegistry, SystemHealthResponseSchema } from '@gev/contracts';
import { SystemClock } from '@gev/core';
import { createGovernanceRuntimeContext } from '@gev/governance';
import {
  createConfiguredProviderRegistry,
  listProviderRegistryFeeds,
  summarizeProviderRegistry,
} from '@gev/providers';
import pc from 'picocolors';

export interface StatusOptions {
  serverUrl?: string;
  json?: boolean;
  governanceDbPath?: string;
}

export const PROJECT_PHASE = 'Phase 5.2 — Provenance and Missing Geospatial Layers';

export async function runStatus(options: StatusOptions = {}): Promise<void> {
  const clock = new SystemClock();
  const serverUrl = options.serverUrl ?? 'http://localhost:3000';

  let isOnline = false;
  let stasisActive = false;
  let spentUsd = 0;
  let capUsd = 10.0;
  let lastTripReason: string | undefined;
  let governanceObservation: {
    source: 'server' | 'offline_snapshot';
    authoritative: boolean;
    runtime: {
      kind: 'shared_sqlite' | 'process_local';
      authoritative: boolean;
      schema_version: number;
      state_revision: number;
    };
  } | null = null;
  let providerRegistry: ProviderRegistry = createConfiguredProviderRegistry();

  // Try querying live server health
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);
  try {
    const res = await fetch(`${serverUrl}/api/health`, { signal: controller.signal });

    if (res.ok) {
      const parsed = SystemHealthResponseSchema.safeParse(await res.json());
      if (parsed.success) {
        isOnline = true;
        stasisActive = parsed.data.stasis_active;
        spentUsd = parsed.data.budget_spent_usd;
        capUsd = parsed.data.budget_cap_usd;
        governanceObservation = {
          source: 'server',
          authoritative: parsed.data.governance_authority.authoritative,
          runtime: parsed.data.governance_authority,
        };
        providerRegistry = parsed.data.provider_registry;
      }
    }
  } catch {
    // Offline fallback — inspect local governor & WAL directly
    isOnline = false;
  } finally {
    clearTimeout(timeout);
  }

  if (!isOnline) {
    // Offline inspection can read the durable file but cannot prove the active
    // server/MCP processes are attached to it, so it is never authoritative.
    const governanceContext = createGovernanceRuntimeContext({
      clock,
      dbPath: options.governanceDbPath,
    });
    try {
      const state = governanceContext.budgetGovernor.state();
      stasisActive = state.stasis_active;
      spentUsd = state.spent_usd;
      capUsd = state.cap_usd;
      lastTripReason = state.last_trip?.code;
      governanceObservation = {
        source: 'offline_snapshot',
        authoritative: false,
        runtime: governanceContext.authority(),
      };
    } finally {
      governanceContext.close();
    }
  }

  const remainingUsd = Math.max(0, capUsd - spentUsd);
  const registryCounts = summarizeProviderRegistry(providerRegistry);
  const registryFeeds = listProviderRegistryFeeds(providerRegistry);
  const feedHealthCounts = {
    healthy: registryFeeds.filter((feed) => feed.status === 'healthy').length,
    degraded: registryFeeds.filter((feed) => feed.status === 'degraded').length,
    unavailable: registryFeeds.filter((feed) => feed.status === 'unavailable').length,
  };
  const stasisLabel = stasisActive
    ? pc.bgRed(pc.white(pc.bold(' STASIS ACTIVE '))) +
      (lastTripReason ? pc.red(` (${lastTripReason})`) : '')
    : pc.green(pc.bold('STASIS_INACTIVE'));

  const modeLabel =
    providerRegistry.requested_mode === 'live'
      ? pc.yellow('LIVE MODE')
      : pc.cyan('SEED MODE (deterministic fixtures)');

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          phase: PROJECT_PHASE,
          server_online: isOnline,
          stasis_active: stasisActive,
          spent_usd: spentUsd,
          cap_usd: capUsd,
          remaining_usd: remainingUsd,
          governance_observation: governanceObservation,
          mode: providerRegistry.requested_mode,
          provider_registry: providerRegistry,
          registry_counts: registryCounts,
        },
        null,
        2
      )
    );
    return;
  }

  console.log(pc.bold(pc.cyan('\n🌍 GEV v2 Console Status (PLAN.md §0)')));
  console.log(pc.dim('───────────────────────────────────────────────'));
  console.log(` ${pc.bold('Project Phase:')}      ${PROJECT_PHASE}`);
  console.log(
    ` ${pc.bold('Server Status:')}      ${isOnline ? pc.green(`ONLINE (${serverUrl})`) : pc.dim('OFFLINE (local inspection)')}`
  );
  console.log(` ${pc.bold('Governance:')}         ${stasisLabel}`);
  console.log(
    ` ${pc.bold('Governance Source:')}  ${governanceObservation?.authoritative ? pc.green('AUTHORITATIVE SERVER') : pc.yellow('NON-AUTHORITATIVE OFFLINE SNAPSHOT')}`
  );
  console.log(
    ` ${pc.bold('Budget Remaining:')}   $${remainingUsd.toFixed(2)} / $${capUsd.toFixed(2)} USD`
  );
  console.log(` ${pc.bold('Provider Mode:')}      ${modeLabel}`);
  console.log(
    ` ${pc.bold('Registry:')}           ${registryCounts.providers.active}/${registryCounts.providers.total} providers · ${registryCounts.feeds.active}/${registryCounts.feeds.total} feeds · ${registryCounts.layers.active}/${registryCounts.layers.total} layers active`
  );
  console.log(
    ` ${pc.bold('Feeds Status:')}       ${pc.green(`${feedHealthCounts.healthy} healthy`)} · ${pc.yellow(`${feedHealthCounts.degraded} degraded`)} · ${pc.dim(`${feedHealthCounts.unavailable} unavailable`)}`
  );
  console.log(pc.dim('───────────────────────────────────────────────\n'));
}
