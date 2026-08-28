import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRODUCT_VERSION, parseProductVersion } from '../src/productVersion.js';

describe('product version authority', () => {
  it('derives the runtime version from the root package manifest', () => {
    const manifestUrl = new URL('../../../package.json', import.meta.url);
    const manifest = JSON.parse(fs.readFileSync(manifestUrl, 'utf-8')) as { version: string };

    expect(PRODUCT_VERSION).toBe(manifest.version);
  });

  it.each([
    undefined,
    null,
    {},
    { version: 1 },
    { version: 'v1.1.0' },
    { version: '1.1' },
    { version: '01.1.0' },
  ])('rejects an invalid canonical manifest: %j', (manifest) => {
    expect(() => parseProductVersion(manifest)).toThrow();
  });
});
