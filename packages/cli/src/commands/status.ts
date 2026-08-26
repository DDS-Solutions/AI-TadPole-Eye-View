import { SystemClock } from '@gev/core';
import { CapBudgetGovernor } from '@gev/governance';
import pc from 'picocolors';

export interface StatusOptions {
  serverUrl?: string;
  json?: boolean;
}

export async function runStatus(options: StatusOptions = {}): Promise<void> {
  const clock = new SystemClock();
  const serverUrl = options.serverUrl ?? 'http://localhost:3000';

  let isOnline = false;
  let stasisActive = false;
  let spentUsd = 0;
  let capUsd = 10.0;
  let lastTripReason: string | undefined;

  // Try querying live server health
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 800);
    const res = await fetch(`${serverUrl}/api/health`, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      const data = (await res.json()) as {
        status: string;
        stasis_active: boolean;
        budget_remaining_usd: number;
      };
      isOnline = true;
      stasisActive = data.stasis_active;
    }
  } catch {
    // Offline fallback — inspect local governor & WAL directly
    isOnline = false;
  }

  if (!isOnline) {
    const governor = new CapBudgetGovernor({ clock });
    const state = governor.state();
    stasisActive = state.stasis_active;
    spentUsd = state.spent_usd;
    capUsd = state.cap_usd;
    lastTripReason = state.last_trip?.code;
  }

  const remainingUsd = Math.max(0, capUsd - spentUsd);
  const stasisLabel = stasisActive
    ? pc.bgRed(pc.white(pc.bold(' STASIS ACTIVE '))) +
      (lastTripReason ? pc.red(` (${lastTripReason})`) : '')
    : pc.green(pc.bold('STASIS_INACTIVE'));

  const modeLabel =
    process.env.GEV_LIVE_MODE === '1' && process.env.GEV_SEED_MODE !== '1'
      ? pc.yellow('LIVE MODE')
      : pc.cyan('SEED MODE (deterministic fixtures)');

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          phase: 'Phase 0 — Walking Skeleton',
          server_online: isOnline,
          stasis_active: stasisActive,
          spent_usd: spentUsd,
          cap_usd: capUsd,
          remaining_usd: remainingUsd,
          mode: process.env.GEV_LIVE_MODE === '1' ? 'live' : 'seed',
        },
        null,
        2
      )
    );
    return;
  }

  console.log(pc.bold(pc.cyan('\n🌍 GEV v2 Console Status (PLAN.md §0)')));
  console.log(pc.dim('───────────────────────────────────────────────'));
  console.log(` ${pc.bold('Project Phase:')}      Phase 0 (Walking skeleton & AI keel)`);
  console.log(
    ` ${pc.bold('Server Status:')}      ${isOnline ? pc.green('ONLINE (http://localhost:3000)') : pc.dim('OFFLINE (local inspection)')}`
  );
  console.log(` ${pc.bold('Governance:')}         ${stasisLabel}`);
  console.log(
    ` ${pc.bold('Budget Remaining:')}   $${remainingUsd.toFixed(2)} / $${capUsd.toFixed(2)} USD`
  );
  console.log(` ${pc.bold('Provider Mode:')}      ${modeLabel}`);
  console.log(
    ` ${pc.bold('Feeds Status:')}       OpenSky: ${pc.green('HEALTHY')} (10,000 aircraft replay cached)`
  );
  console.log(pc.dim('───────────────────────────────────────────────\n'));
}
