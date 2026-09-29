import { DEFAULT_PROVIDER_TIERS } from './costGovernorConfig.js';

export const RECOGNIZED_FEED_QUERY_PARAMS = new Set([
  'lamin',
  'lamax',
  'lomin',
  'lomax',
  'min_lat',
  'max_lat',
  'min_lon',
  'max_lon',
  'min_mag',
  'category',
  'agency',
  'time',
  'format',
  'since',
  'q',
  'query',
  'search',
  'limit',
  'offset',
  'different',
]);

export function canonicalFeedKey(providerName: string, rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl, 'http://localhost');
    const sortedParams = new URLSearchParams();
    const entries = Array.from(parsed.searchParams.entries()).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    const filterRecognized = DEFAULT_PROVIDER_TIERS[providerName] !== undefined;
    for (const [key, value] of entries) {
      if (!filterRecognized || RECOGNIZED_FEED_QUERY_PARAMS.has(key.toLowerCase())) {
        sortedParams.append(key, value);
      }
    }
    const queryString = sortedParams.toString();
    return queryString ? `${parsed.pathname}?${queryString}` : parsed.pathname;
  } catch {
    return rawUrl;
  }
}
