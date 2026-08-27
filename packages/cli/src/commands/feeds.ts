import type { ProviderRegistry, ProviderRegistryFeedView } from '@gev/contracts';
import { createConfiguredProviderRegistry, listProviderRegistryFeeds } from '@gev/providers';
import pc from 'picocolors';

export interface FeedsHealthOptions {
  providerRegistry?: ProviderRegistry;
}

function colorStatus(feed: ProviderRegistryFeedView): string {
  const label = feed.status.toUpperCase().padEnd(12);
  if (feed.status === 'healthy') {
    return pc.green(label);
  }
  if (feed.status === 'degraded') {
    return pc.yellow(label);
  }
  return pc.dim(label);
}

export async function runFeedsHealth(options: FeedsHealthOptions = {}): Promise<void> {
  const providerRegistry = options.providerRegistry ?? createConfiguredProviderRegistry();
  const feeds = listProviderRegistryFeeds(providerRegistry);

  console.log(pc.bold(pc.cyan('\n📡 GEV v2 Feed Diagnostics (PLAN.md §7.2)')));
  console.log(
    pc.dim('────────────────────────────────────────────────────────────────────────────')
  );
  console.log(
    `${pc.bold('Provider'.padEnd(24))} ${pc.bold('Feed'.padEnd(14))} ${pc.bold('Status'.padEnd(12))} ${pc.bold('Mode'.padEnd(14))} ${pc.bold('Implementation')}`
  );
  console.log(
    pc.dim('────────────────────────────────────────────────────────────────────────────')
  );

  for (const feed of feeds) {
    const mode = feed.mode.toUpperCase().padEnd(14);
    console.log(
      `${feed.provider_name.slice(0, 23).padEnd(24)} ${feed.id.padEnd(14)} ${colorStatus(feed)} ${mode} ${feed.implementation}`
    );
  }
  console.log(
    pc.dim('────────────────────────────────────────────────────────────────────────────\n')
  );
}
