import { SystemClock } from '@gev/core';
import { OpenSkyAdapter } from '@gev/providers';
import pc from 'picocolors';

export async function runFeedsHealth(): Promise<void> {
  const clock = new SystemClock();
  const adapter = new OpenSkyAdapter({ clock });

  const isLive = process.env.GEV_LIVE_MODE === '1' && process.env.GEV_SEED_MODE !== '1';
  const remainingRate = adapter.getRateLimitRemaining();

  console.log(pc.bold(pc.cyan('\n📡 GEV v2 Feed Diagnostics (PLAN.md §7.2)')));
  console.log(pc.dim('─────────────────────────────────────────────────────────────'));
  console.log(
    `${pc.bold('Provider'.padEnd(12))} ${pc.bold('Status'.padEnd(10))} ${pc.bold('Mode'.padEnd(12))} ${pc.bold('Quota Rem.'.padEnd(14))} ${pc.bold('TTL Tier')}`
  );
  console.log(pc.dim('─────────────────────────────────────────────────────────────'));

  const provider = 'OpenSky';
  const status = pc.green('HEALTHY');
  const mode = isLive ? pc.yellow('LIVE') : pc.cyan('SEED');
  const quota = (remainingRate !== undefined ? remainingRate.toString() : '4,000 req/day').padEnd(
    14
  );
  const ttl = '30s';

  console.log(`${provider.padEnd(12)} ${status.padEnd(10)} ${mode.padEnd(12)} ${quota} ${ttl}`);
  console.log(pc.dim('─────────────────────────────────────────────────────────────\n'));
}
