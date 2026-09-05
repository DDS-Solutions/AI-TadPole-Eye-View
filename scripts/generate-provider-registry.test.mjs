import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  PROVIDER_REGISTRY_SECTION_END,
  PROVIDER_REGISTRY_SECTION_START,
  replaceProviderRegistrySection,
  updateProviderRegistryDocuments,
} from './lib/provider-registry-docs.mjs';

function documentWithGeneratedSection(generated = 'old generated content') {
  return [
    '# Authored heading',
    '',
    'Authored policy before.',
    PROVIDER_REGISTRY_SECTION_START,
    generated,
    PROVIDER_REGISTRY_SECTION_END,
    'Authored policy after.',
    '',
  ].join('\n');
}

test('replaces only the marker-delimited provider-registry section', () => {
  const current = documentWithGeneratedSection();
  const next = replaceProviderRegistrySection(current, 'new row\nsecond row\n');

  assert.match(next, /Authored policy before\./);
  assert.match(next, /Authored policy after\./);
  assert.match(next, /new row\nsecond row/);
  assert.doesNotMatch(next, /old generated content/);
});

test('check mode fails on every stale generated document without writing', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-provider-docs-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const firstPath = path.join(root, 'DATA_SOURCES.md');
  const secondPath = path.join(root, 'provider-registry.md');
  fs.writeFileSync(firstPath, documentWithGeneratedSection('stale first'), 'utf8');
  fs.writeFileSync(secondPath, documentWithGeneratedSection('stale second'), 'utf8');
  const documents = [
    { label: 'DATA_SOURCES.md', path: firstPath, generatedContent: 'current first' },
    {
      label: 'docs/generated/provider-registry.md',
      path: secondPath,
      generatedContent: 'current second',
    },
  ];

  await assert.rejects(
    updateProviderRegistryDocuments(documents, { check: true }),
    (error) =>
      error instanceof Error &&
      error.message.includes('DATA_SOURCES.md') &&
      error.message.includes('docs/generated/provider-registry.md')
  );
  assert.equal(fs.readFileSync(firstPath, 'utf8'), documentWithGeneratedSection('stale first'));
  assert.equal(fs.readFileSync(secondPath, 'utf8'), documentWithGeneratedSection('stale second'));

  const result = await updateProviderRegistryDocuments(documents);
  assert.deepEqual(result.changed, ['DATA_SOURCES.md', 'docs/generated/provider-registry.md']);
  await assert.doesNotReject(updateProviderRegistryDocuments(documents, { check: true }));
});

test('invalid markers abort all document writes', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-provider-markers-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const validPath = path.join(root, 'valid.md');
  const invalidPath = path.join(root, 'invalid.md');
  const original = documentWithGeneratedSection('old');
  fs.writeFileSync(validPath, original, 'utf8');
  fs.writeFileSync(invalidPath, '# Missing generated markers\n', 'utf8');

  await assert.rejects(
    updateProviderRegistryDocuments([
      { label: 'valid.md', path: validPath, generatedContent: 'new' },
      { label: 'invalid.md', path: invalidPath, generatedContent: 'new' },
    ]),
    /exactly one provider-registry marker pair/
  );
  assert.equal(fs.readFileSync(validPath, 'utf8'), original);
});
