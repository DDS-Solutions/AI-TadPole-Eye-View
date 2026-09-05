import { fileURLToPath } from 'node:url';
import {
  createProviderRegistry,
  renderProviderRegistryMarkdown,
} from '../packages/providers/dist/index.js';
import { updateProviderRegistryDocuments } from './lib/provider-registry-docs.mjs';

const arguments_ = process.argv.slice(2);
if (arguments_.some((argument) => argument !== '--check') || arguments_.length > 1) {
  throw new Error('Usage: node scripts/generate-provider-registry.mjs [--check]');
}

const check = arguments_[0] === '--check';
const registry = createProviderRegistry({ requestedMode: 'seed' });
await updateProviderRegistryDocuments(
  [
    {
      label: 'DATA_SOURCES.md',
      path: fileURLToPath(new URL('../DATA_SOURCES.md', import.meta.url)),
      generatedContent: renderProviderRegistryMarkdown(registry, {
        headingLevel: 3,
        documentationHref: (documentationPath) => `./${documentationPath}`,
      }),
    },
    {
      label: 'docs/generated/provider-registry.md',
      path: fileURLToPath(new URL('../docs/generated/provider-registry.md', import.meta.url)),
      generatedContent: renderProviderRegistryMarkdown(registry, {
        headingLevel: 2,
        documentationHref: (documentationPath) => `../${documentationPath.replace(/^docs\//, '')}`,
      }),
    },
  ],
  { check }
);
