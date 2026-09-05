import { readFile, writeFile } from 'node:fs/promises';

export const PROVIDER_REGISTRY_SECTION_START = '<!-- BEGIN GENERATED: provider-registry -->';
export const PROVIDER_REGISTRY_SECTION_END = '<!-- END GENERATED: provider-registry -->';

function markerMatches(content, marker) {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...content.matchAll(new RegExp(`^${escaped}(?=\\r?$)`, 'gm'))];
}

function normalizeNewlines(content, newline) {
  return content.replace(/\r\n|\r|\n/g, newline);
}

export function replaceProviderRegistrySection(documentContent, generatedContent) {
  const starts = markerMatches(documentContent, PROVIDER_REGISTRY_SECTION_START);
  const ends = markerMatches(documentContent, PROVIDER_REGISTRY_SECTION_END);
  if (starts.length !== 1 || ends.length !== 1) {
    throw new Error(
      `Expected exactly one provider-registry marker pair; found ${starts.length} start and ${ends.length} end markers`
    );
  }

  const startIndex = starts[0]?.index;
  const endIndex = ends[0]?.index;
  if (startIndex === undefined || endIndex === undefined || endIndex <= startIndex) {
    throw new Error('Provider-registry generated markers are out of order');
  }

  if (
    generatedContent.includes(PROVIDER_REGISTRY_SECTION_START) ||
    generatedContent.includes(PROVIDER_REGISTRY_SECTION_END)
  ) {
    throw new Error('Generated provider-registry content must not contain section markers');
  }

  const newline = documentContent.includes('\r\n') ? '\r\n' : '\n';
  const normalizedGenerated = normalizeNewlines(generatedContent.trimEnd(), newline);
  if (normalizedGenerated === '') {
    throw new Error('Generated provider-registry content must not be empty');
  }

  const replacement = [
    PROVIDER_REGISTRY_SECTION_START,
    normalizedGenerated,
    PROVIDER_REGISTRY_SECTION_END,
  ].join(newline);
  return (
    documentContent.slice(0, startIndex) +
    replacement +
    documentContent.slice(endIndex + PROVIDER_REGISTRY_SECTION_END.length)
  );
}

export async function updateProviderRegistryDocuments(documents, { check = false } = {}) {
  const plannedUpdates = [];
  for (const document of documents) {
    const currentContent = await readFile(document.path, 'utf8');
    const nextContent = replaceProviderRegistrySection(currentContent, document.generatedContent);
    plannedUpdates.push({ ...document, currentContent, nextContent });
  }

  const stale = plannedUpdates.filter(
    ({ currentContent, nextContent }) => currentContent !== nextContent
  );
  if (check && stale.length > 0) {
    throw new Error(
      `Generated provider documentation is stale:\n${stale.map(({ label }) => `- ${label}`).join('\n')}`
    );
  }

  if (!check) {
    await Promise.all(stale.map(({ path, nextContent }) => writeFile(path, nextContent, 'utf8')));
  }

  return { changed: stale.map(({ label }) => label) };
}
