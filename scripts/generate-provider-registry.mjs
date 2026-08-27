import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  createProviderRegistry,
  renderProviderRegistryMarkdown,
} from '../packages/providers/dist/index.js';

const outputUrl = new URL('../docs/generated/provider-registry.md', import.meta.url);
await mkdir(fileURLToPath(new URL('.', outputUrl)), { recursive: true });
await writeFile(
  fileURLToPath(outputUrl),
  renderProviderRegistryMarkdown(createProviderRegistry({ requestedMode: 'seed' })),
  'utf8'
);
