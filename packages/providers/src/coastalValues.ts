import type { CoastalValue } from '@gev/contracts';
import { normalizeIsoTime } from './operationalHttp.js';

export interface CoopsInstant {
  iso: string;
  milliseconds: number;
}

export function coopsInstant(
  value: unknown,
  field: string,
  cache: Map<string, CoopsInstant>
): CoopsInstant {
  const text = String(value ?? '').trim();
  const cached = cache.get(text);
  if (cached) return cached;
  const iso = normalizeIsoTime(
    /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text.replace(' ', 'T')}Z`,
    field
  );
  const instant = { iso, milliseconds: Date.parse(iso) };
  cache.set(text, instant);
  return instant;
}

export function numericValue(
  value: unknown,
  label: string,
  cache: Map<string, CoastalValue>
): CoastalValue {
  const key = `${label}\u0000${String(value ?? '')}`;
  const cached = cache.get(key);
  if (cached) return cached;
  if (value === null || value === undefined || String(value).trim() === '') {
    const missing = { status: 'unavailable' as const, reason: `${label} was not reported` };
    cache.set(key, missing);
    return missing;
  }
  const number = Number(value);
  const normalized: CoastalValue = Number.isFinite(number)
    ? { status: 'available', value: number }
    : { status: 'unavailable', reason: `${label} was suppressed or invalid` };
  cache.set(key, normalized);
  return normalized;
}

export function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function coopsDate(milliseconds: number): string {
  return new Date(milliseconds).toISOString().slice(0, 16).replaceAll('-', '').replace('T', ' ');
}

export function strings(value: unknown, cache: Map<string, string[]>): string[] {
  const key = Array.isArray(value) ? value.join(',') : String(value ?? '');
  const cached = cache.get(key);
  if (cached) return cached;
  const normalized = key
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
  cache.set(key, normalized);
  return normalized;
}
