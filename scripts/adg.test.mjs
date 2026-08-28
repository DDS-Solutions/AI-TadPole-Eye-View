import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DESIGNATED_ROOT_DOCS,
  formatAdgReport,
  runActiveDocumentationGuard,
} from './lib/adg-core.mjs';

const PLAN = `# Test plan

**Plan version:** 3.0
**Status:** IN PROGRESS — Phase 5.0

\`\`\`text
PLAN_VERSION=3.0
CURRENT_PHASE=5.0
NEXT_TASK=5.0.4
NEXT_TASK_STATUS=READY
\`\`\`

- [ ] **5.0.4 Make ADG meaningful.**
`;

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-adg-'));
  const rootContents = {
    'PLAN.md': PLAN,
    'MASTER_PLAN_V3.md': PLAN,
    'README.md':
      '# Test\n\n[![Phase](https://img.shields.io/badge/phase-5.0%20(Hardening)-blue)](./PLAN.md)\n',
    'SECURITY.md': '# Security\n\n**Status:** Phase 5.0 hardening\n',
    'CHANGELOG.md': '# Changelog\n\n## [1.1.0] (2026-08-27)\n',
  };
  for (const doc of DESIGNATED_ROOT_DOCS) write(root, doc, rootContents[doc] ?? `# ${doc}\n`);
  write(root, 'package.json', '{"name":"fixture","version":"1.1.0","type":"module"}\n');
  write(
    root,
    'packages/cli/src/commands/status.ts',
    "export const PROJECT_PHASE = 'Phase 5.0 — Safety and Source-of-Truth Bootstrap';\n"
  );
  write(root, 'packages/contracts/src/example.ts', 'export const PresentSymbol = true;\n');
  write(
    root,
    'docs/reference.md',
    '# Reference\n\n`PresentSymbol` in `packages/contracts/src/example.ts`.\n'
  );
  return root;
}

function run(root) {
  return runActiveDocumentationGuard({ root });
}

function messages(report) {
  return report.errors.map((error) => `${error.file}:${error.line} ${error.message}`);
}

test('passes synchronized claims, implemented paths, and module members', (t) => {
  const root = createFixture();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const report = run(root);
  assert.equal(report.ok, true, formatAdgReport(report));
  assert.equal(report.checkedSymbols, 1);
});

test('fails a missing implemented path with file and line evidence', (t) => {
  const root = createFixture();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  write(root, 'docs/reference.md', '# Reference\n\nMissing `packages/contracts/src/missing.ts`.\n');
  const report = run(root);
  assert.equal(report.ok, false);
  assert(
    messages(report).some(
      (message) => message.includes('docs/reference.md:3') && message.includes('missing.ts')
    )
  );
});

test('validates a symbol inside its declared module instead of repository-wide', (t) => {
  const root = createFixture();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  write(root, 'packages/other/src/other.ts', 'export const WrongModuleSymbol = true;\n');
  write(
    root,
    'docs/reference.md',
    '# Reference\n\n`WrongModuleSymbol` in `packages/contracts/src/example.ts`.\n'
  );
  const report = run(root);
  assert.equal(report.ok, false);
  assert(
    messages(report).some(
      (message) => message.includes('WrongModuleSymbol') && message.includes('example.ts')
    )
  );
});

test('fails stale README phase claims against PLAN.md', (t) => {
  const root = createFixture();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  write(
    root,
    'README.md',
    '# Test\n\n[![Phase](https://img.shields.io/badge/phase-4.0%20(Legacy)-blue)](./PLAN.md)\n'
  );
  const report = run(root);
  assert.equal(report.ok, false);
  assert(
    messages(report).some(
      (message) => message.includes('README.md:3') && message.includes('expected 5.0')
    )
  );
});

test('fails a stale CLI phase claim against PLAN.md', (t) => {
  const root = createFixture();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  write(
    root,
    'packages/cli/src/commands/status.ts',
    "export const PROJECT_PHASE = 'Phase 4 — Hygiene and Showcase';\n"
  );
  const report = run(root);
  assert.equal(report.ok, false);
  assert(
    messages(report).some(
      (message) =>
        message.includes('packages/cli/src/commands/status.ts:1') &&
        message.includes('expected 5.0')
    )
  );
});

test('fails a completed checkpoint status while the next task is unchecked', (t) => {
  const root = createFixture();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const stale = PLAN.replace('NEXT_TASK_STATUS=READY', 'NEXT_TASK_STATUS=COMPLETE');
  write(root, 'PLAN.md', stale);
  write(root, 'MASTER_PLAN_V3.md', stale);
  const report = run(root);
  assert.equal(report.ok, false);
  assert(
    messages(report).some(
      (message) => message.includes('NEXT_TASK_STATUS') && message.includes('unchecked')
    )
  );
});

test('fails the latest CHANGELOG version when it differs from package.json', (t) => {
  const root = createFixture();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  write(root, 'CHANGELOG.md', '# Changelog\n\n## [1.0.0] (2026-08-26)\n');
  const report = run(root);
  assert.equal(report.ok, false);
  assert(
    messages(report).some(
      (message) => message.includes('CHANGELOG.md:3') && message.includes('expected 1.1.0')
    )
  );
});

test('fails byte-level plan mirror drift', (t) => {
  const root = createFixture();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  write(root, 'MASTER_PLAN_V3.md', `${PLAN}\n`);
  const report = run(root);
  assert.equal(report.ok, false);
  assert(messages(report).some((message) => message.includes('Plan mirror differs byte-for-byte')));
});

test('allows only an exact same-line marker for a concrete planned path', (t) => {
  const root = createFixture();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  write(
    root,
    'docs/reference.md',
    '# Reference\n\nFuture `packages/economics/src/index.ts` <!-- adg:planned-path packages/economics/src/index.ts -->\n'
  );
  const report = run(root);
  assert.equal(report.ok, true, formatAdgReport(report));

  write(
    root,
    'docs/reference.md',
    '# Reference\n\nFuture `packages/economics/src/index.ts` <!-- adg:planned-path packages/economics -->\n'
  );
  const mismatch = run(root);
  assert.equal(mismatch.ok, false);
  assert(messages(mismatch).some((message) => message.includes('must exactly match')));

  write(
    root,
    'docs/reference.md',
    '# Reference\n\nFuture `packages/economics/*` <!-- adg:planned-path packages/economics/* -->\n'
  );
  const wildcard = run(root);
  assert.equal(wildcard.ok, false);
  assert(messages(wildcard).some((message) => message.includes('must exactly match')));
});

test('requires every designated root document', (t) => {
  const root = createFixture();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  fs.rmSync(path.join(root, 'VERSION_CONTROL.md'));
  const report = run(root);
  assert.equal(report.ok, false);
  assert(messages(report).some((message) => message.includes('VERSION_CONTROL.md:0')));
});

test('keeps diagnostics stable across CRLF line endings', (t) => {
  const root = createFixture();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  write(
    root,
    'docs/reference.md',
    '# Reference\r\n\r\nMissing `packages/contracts/src/missing.ts`.\r\n'
  );
  const report = run(root);
  assert(messages(report).some((message) => message.startsWith('docs/reference.md:3')));
});
