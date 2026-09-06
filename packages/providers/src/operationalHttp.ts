import type { OperationalAoi, OperationalAreaGeometry } from '@gev/contracts';
import { type PinnedFetchOptions, pinnedFetch } from '@gev/security';

export interface OperationalHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type OperationalFetcher = (
  url: string,
  options: PinnedFetchOptions
) => Promise<OperationalHttpResponse>;

export const defaultOperationalFetcher: OperationalFetcher = (url, options) =>
  pinnedFetch(url, options);

export function assertIdentifiedUserAgent(
  value: string | undefined,
  contactRequired: boolean
): string {
  const normalized = value?.trim() ?? '';
  const hasIdentity = normalized.length >= 12 && /[a-z0-9]/i.test(normalized);
  const hasContact = /https?:\/\//i.test(normalized) || /[^\s@]+@[^\s@]+\.[^\s@]+/.test(normalized);
  if (!hasIdentity || (contactRequired && !hasContact)) {
    throw new Error(
      contactRequired
        ? 'A stable contact-bearing User-Agent is required'
        : 'A stable descriptive User-Agent is required'
    );
  }
  return normalized;
}

export async function readBoundedJson(
  response: OperationalHttpResponse,
  maxBytes: number
): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`Upstream returned HTTP ${response.status}`);
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new Error(`Upstream response exceeds ${maxBytes} bytes`);
  }
  if (text.trim() === '') return { type: 'FeatureCollection', features: [] };
  return JSON.parse(text) as unknown;
}

function collectCoordinates(geometry: OperationalAreaGeometry): Array<[number, number]> {
  if (geometry.type === 'Polygon') return geometry.coordinates.flat();
  return geometry.coordinates.flat(2);
}

export function geometryIntersectsAoi(
  geometry: OperationalAreaGeometry,
  aoi: OperationalAoi
): boolean {
  const coordinates = collectCoordinates(geometry);
  let minLon = 180;
  let maxLon = -180;
  let minLat = 90;
  let maxLat = -90;
  for (const [longitude, latitude] of coordinates) {
    minLon = Math.min(minLon, longitude);
    maxLon = Math.max(maxLon, longitude);
    minLat = Math.min(minLat, latitude);
    maxLat = Math.max(maxLat, latitude);
  }
  return !(
    maxLon < aoi.min_lon ||
    minLon > aoi.max_lon ||
    maxLat < aoi.min_lat ||
    minLat > aoi.max_lat
  );
}

export function pointInAoi(longitude: number, latitude: number, aoi: OperationalAoi): boolean {
  return (
    latitude >= aoi.min_lat &&
    latitude <= aoi.max_lat &&
    longitude >= aoi.min_lon &&
    longitude <= aoi.max_lon
  );
}

export function normalizeIsoTime(value: unknown, fieldName: string): string {
  const milliseconds = typeof value === 'number' ? value * 1000 : Date.parse(String(value));
  if (!Number.isFinite(milliseconds)) throw new Error(`Invalid ${fieldName}`);
  return new Date(milliseconds).toISOString();
}

export function normalizedAoiKey(aoi: OperationalAoi): string {
  return [aoi.min_lat, aoi.min_lon, aoi.max_lat, aoi.max_lon]
    .map((value) => value.toFixed(3))
    .join(',');
}
