import { SceneState } from '@gev/contracts';
import type { SimClock } from './clock.js';
import { SystemClock } from './clock.js';

/**
 * Universal base64url encoder supporting Node.js, Browsers, and Web Workers.
 */
export function stringToBase64Url(str: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  // Browser / Web Worker environment
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Universal base64url decoder supporting Node.js, Browsers, and Web Workers.
 */
export function base64UrlToString(base64url: string): string {
  // Normalize base64url back to standard base64 with padding
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(base64, 'base64').toString('utf-8');
  }

  // Browser / Web Worker environment
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Serializes a validated SceneState into a compact, URL-safe base64url string.
 * Enforces contract validation prior to encoding (PLAN.md §2 Law 8).
 */
export function serializeScene(scene: SceneState): string {
  const validated = SceneState.parse(scene);
  const jsonStr = JSON.stringify(validated);
  return stringToBase64Url(jsonStr);
}

/**
 * Deserializes and validates a base64url or raw JSON string into a verified SceneState.
 * Throws a descriptive error if the payload is malformed or invalid.
 */
export function deserializeScene(payload: string): SceneState {
  const trimmed = payload.trim();
  let jsonString: string;

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    // Raw JSON string
    jsonString = trimmed;
  } else {
    // Base64url encoded string
    try {
      jsonString = base64UrlToString(trimmed);
    } catch {
      throw new Error(`Failed to decode base64url scene payload: ${trimmed.slice(0, 32)}...`);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new Error('Scene payload contains invalid JSON');
  }

  return SceneState.parse(parsed);
}

/**
 * Safely deserializes a scene payload with fallback to default if malformed.
 */
export function deserializeSceneSafe(payload?: string | null, fallback?: SceneState): SceneState {
  if (!payload) {
    return fallback ?? getDefaultSceneState();
  }

  try {
    return deserializeScene(payload);
  } catch {
    return fallback ?? getDefaultSceneState();
  }
}

/**
 * Creates a reproducible URL deep link embedding the serialized globe state.
 */
export function createSceneDeepLink(baseUrl: string, scene: SceneState): string {
  const serialized = serializeScene(scene);
  const cleanBase = baseUrl.split('#')[0]?.split('?')[0] || baseUrl;
  return `${cleanBase}#scene=${serialized}`;
}

/**
 * Extracts and deserializes a SceneState from a deep link URL or hash fragment.
 */
export function parseSceneFromUrl(urlOrHash: string): SceneState | null {
  if (!urlOrHash) {
    return null;
  }

  // Check for #scene=... or ?scene=...
  const hashIndex = urlOrHash.indexOf('#');
  const fragment = hashIndex !== -1 ? urlOrHash.slice(hashIndex + 1) : urlOrHash;

  const match = fragment.match(/(?:^|[&?#])scene=([^&]+)/);
  if (!match || !match[1]) {
    return null;
  }

  try {
    return deserializeScene(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

/**
 * Constructs the canonical default SceneState baseline.
 */
export function getDefaultSceneState(clock: SimClock = new SystemClock()): SceneState {
  const nowIso = new Date(clock.now()).toISOString();
  return SceneState.parse({
    version: 1,
    created_at: nowIso,
    camera: {
      longitude: 0,
      latitude: 20,
      altitude: 20000000,
      heading: 0,
      pitch: -90,
      roll: 0,
    },
    layers: [
      { id: 'flights', enabled: true, opacity: 1 },
      { id: 'osm_raster', enabled: true, opacity: 1 },
    ],
    selected_entity: null,
    aois: [],
    sim_time: {
      iso: nowIso,
      rate: 1,
      paused: false,
    },
  });
}
