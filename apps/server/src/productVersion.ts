import fs from 'node:fs';

const PRODUCT_MANIFEST_URL = new URL('../../../package.json', import.meta.url);
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/**
 * Validates the repository product version read from the canonical root package manifest.
 */
export function parseProductVersion(manifest: unknown): string {
  if (!manifest || typeof manifest !== 'object' || !('version' in manifest)) {
    throw new Error('Root package.json must define the canonical product version');
  }

  const version = (manifest as { version?: unknown }).version;
  if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
    throw new Error('Root package.json product version must be valid SemVer');
  }

  return version;
}

function readProductVersion(): string {
  const manifest = JSON.parse(fs.readFileSync(PRODUCT_MANIFEST_URL, 'utf-8')) as unknown;
  return parseProductVersion(manifest);
}

/** The root package.json is the sole product-version authority. */
export const PRODUCT_VERSION = readProductVersion();
