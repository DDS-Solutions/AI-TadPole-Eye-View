import { getFeedFreshnessSeconds } from '@gev/providers';

export interface ProviderTierConfig {
  ttlSeconds: number;
  costPerFetchUsd: number;
  maxStaleSeconds: number;
}

function providerTier(
  feedId: string,
  costPerFetchUsd: number,
  maxStaleSeconds: number
): ProviderTierConfig {
  return {
    ttlSeconds: getFeedFreshnessSeconds(feedId),
    costPerFetchUsd,
    maxStaleSeconds,
  };
}

export const DEFAULT_PROVIDER_TIERS: Record<string, ProviderTierConfig> = {
  flights: providerTier('flights', 0.0001, 60),
  ships: providerTier('ships', 0.0005, 300),
  quakes: providerTier('quakes', 0, 3600),
  firms: providerTier('firms', 0.001, 7200),
  gbfs: providerTier('gbfs', 0, 600),
  weather: providerTier('weather', 0, 3600),
  launches: providerTier('launches', 0, 7200),
  radio: providerTier('radio', 0, 600),
  cctv: providerTier('cctv', 0.001, 120),
  overpass: providerTier('overpass', 0, 600),
  cables: providerTier('cables', 0, 604_800),
};
