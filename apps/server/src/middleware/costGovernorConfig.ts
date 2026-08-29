export interface ProviderTierConfig {
  ttlSeconds: number;
  costPerFetchUsd: number;
  maxStaleSeconds: number;
}

export const DEFAULT_PROVIDER_TIERS: Record<string, ProviderTierConfig> = {
  flights: { ttlSeconds: 5, costPerFetchUsd: 0.0001, maxStaleSeconds: 60 },
  ships: { ttlSeconds: 15, costPerFetchUsd: 0.0005, maxStaleSeconds: 300 },
  quakes: { ttlSeconds: 60, costPerFetchUsd: 0, maxStaleSeconds: 3600 },
  firms: { ttlSeconds: 300, costPerFetchUsd: 0.001, maxStaleSeconds: 7200 },
  gbfs: { ttlSeconds: 30, costPerFetchUsd: 0, maxStaleSeconds: 600 },
  weather: { ttlSeconds: 300, costPerFetchUsd: 0, maxStaleSeconds: 3600 },
  launches: { ttlSeconds: 600, costPerFetchUsd: 0, maxStaleSeconds: 7200 },
  radio: { ttlSeconds: 60, costPerFetchUsd: 0, maxStaleSeconds: 600 },
  cctv: { ttlSeconds: 10, costPerFetchUsd: 0.001, maxStaleSeconds: 120 },
  overpass: { ttlSeconds: 30, costPerFetchUsd: 0, maxStaleSeconds: 600 },
};
