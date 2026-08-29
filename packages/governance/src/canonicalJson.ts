export type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | CanonicalJson[]
  | CanonicalJsonObject;

export interface CanonicalJsonObject {
  [key: string]: CanonicalJson;
}

/** RFC 8785-compatible serialization for validated I-JSON values. */
export function canonicalizeJson(value: CanonicalJson): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('JCS canonicalization rejects non-finite numbers');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key] as CanonicalJson)}`)
    .join(',')}}`;
}
