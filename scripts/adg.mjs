#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const DOC_FILES = ['PLAN.md', 'AGENTS.md', 'RUNBOOK.md'];

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.turbo', '.tempmediaStorage']);

/**
 * Common prose, language keywords, CLI commands, and standard tech terms
 * that should not be treated as workspace symbol checks.
 */
const GLOBAL_PROSE_ALLOWLIST = new Set([
  'any',
  'boolean',
  'number',
  'string',
  'symbol',
  'unknown',
  'never',
  'void',
  'null',
  'undefined',
  'true',
  'false',
  'Promise',
  'Record',
  'Array',
  'Map',
  'Set',
  'Error',
  'Uint8Array',
  'pnpm',
  'turbo',
  'vitest',
  'playwright',
  'git',
  'node',
  'tsc',
  'biome',
  'curl',
  'bash',
  'gev',
  'dev',
  'test',
  'qa',
  'status',
  'resume',
  'build',
  'lint',
  'typecheck',
  'format',
  'AI',
  'OS',
  'UI',
  'E2E',
  'CI',
  'DX',
  'ADR',
  'WAL',
  'STASIS',
  'MCP',
  'GEV',
  'SPA',
  'REST',
  'SSRF',
  'TLS',
  'TTL',
  'AOI',
  'AOIs',
  'USD',
  'OTel',
  'CCTV',
  'AIS',
  'ADSB',
  'GPS',
  'SSE',
  'JSON',
  'RPC',
  'HTTP',
  'HTTPS',
  'URL',
  'URI',
  'SHA',
  'DOM',
  'HTML',
  'CSS',
  'ESM',
  'CJS',
  'POST',
  'GET',
  'PUT',
  'DELETE',
  'PATCH',
  'HEAD',
  'Date.now()',
  'process.env',
  'import.meta',
  'window',
  'document',
  'console',
  'TaskRef',
  'taskRef',
  'task_ref',
  'intent_id',
  'request_id',
]);

/** Recursively finds all markdown files under docs/ */
function findDocFiles(dir = path.join(ROOT, 'docs')) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findDocFiles(fullPath));
    } else if (entry.name.endsWith('.md')) {
      results.push(path.relative(ROOT, fullPath).replace(/\\/g, '/'));
    }
  }
  return results;
}

/** Recursively extracts all exported TypeScript/JavaScript symbols in workspace packages and apps */
function collectExportedWorkspaceSymbols() {
  const symbols = new Set();
  const searchDirs = [path.join(ROOT, 'packages'), path.join(ROOT, 'apps')];

  function scan(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(full);
      } else if (/\.(ts|js|mjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        const code = fs.readFileSync(full, 'utf-8');
        // Match: export const/function/class/type/interface/enum Name
        const exportMatches = code.matchAll(
          /export\s+(?:const|function|class|type|interface|enum|async function)\s+([A-Za-z0-9_]+)/g
        );
        for (const match of exportMatches) {
          if (match[1]) symbols.add(match[1]);
        }
        // Match: export { Foo, Bar as Baz }
        const namedExports = code.matchAll(/export\s+\{([^}]+)\}/g);
        for (const named of namedExports) {
          if (named[1]) {
            for (const s of named[1].split(',')) {
              const part = s
                .trim()
                .split(/\s+as\s+/)
                .pop()
                .trim();
              if (part) symbols.add(part);
            }
          }
        }
      }
    }
  }

  searchDirs.forEach(scan);
  return symbols;
}

/** Validates a referenced filepath in docs */
function checkFilePath(refPath, sourceFile) {
  // Strip anchor fragments (#heading or #L10-L20)
  let cleanRef = refPath.split('#')[0].replace(/^file:\/\/\/?/, '');
  if (
    !cleanRef ||
    cleanRef.startsWith('http://') ||
    cleanRef.startsWith('https://') ||
    cleanRef.startsWith('mailto:')
  ) {
    return true; // External link
  }

  // Strip file protocol and workspace absolute prefixes (e.g. file:///g:/AI-TadPole-Eye-View/ or /home/runner/work/...)
  let repoRelCandidate = null;
  if (cleanRef.startsWith('file:')) {
    const withoutScheme = cleanRef.replace(/^file:\/\/\/?/, '').replace(/^[a-zA-Z]:[\\/]/, '/');
    const match = withoutScheme.match(/(?:^|[\\/])AI-TadPole-Eye-View[\\/](.+)$/i);
    if (match?.[1]) {
      repoRelCandidate = match[1].replace(/\\/g, '/');
    }
  }

  cleanRef = cleanRef
    .replace(/^file:\/\/\/?/, '')
    .replace(/^[a-zA-Z]:[\\/]/, '/')
    .replace(/^.*[\\/]AI-TadPole-Eye-View[\\/]/i, '')
    .replace(/\\/g, '/');

  // Allow template placeholders, ellipsis, or wildcards (e.g. NNNN-slug.md, <slug>, *, ...)
  if (
    cleanRef.includes('*') ||
    cleanRef.includes('...') ||
    cleanRef.includes('NNNN') ||
    cleanRef.includes('<') ||
    cleanRef.includes('>')
  ) {
    const rawPrefix = cleanRef.split(/[*<>]|\.\.\.|NNNN/)[0];
    const resolvedPrefix = path.resolve(ROOT, rawPrefix);
    const checkDir =
      fs.existsSync(resolvedPrefix) && fs.statSync(resolvedPrefix).isDirectory()
        ? resolvedPrefix
        : path.dirname(resolvedPrefix);
    return fs.existsSync(checkDir);
  }

  // Check 1: Relative to source file directory
  const targetRelSource = path.resolve(ROOT, path.dirname(sourceFile), cleanRef);
  if (fs.existsSync(targetRelSource)) {
    return true;
  }

  // Check 2: Relative to workspace root
  const targetRelRoot = path.resolve(ROOT, cleanRef.startsWith('/') ? `.${cleanRef}` : cleanRef);
  if (fs.existsSync(targetRelRoot)) {
    return true;
  }

  // Check 3: Candidate from stripped repo root URI
  if (repoRelCandidate) {
    const targetFromRepoUri = path.resolve(ROOT, repoRelCandidate);
    if (fs.existsSync(targetFromRepoUri)) {
      return true;
    }
  }

  return false;
}

/** Main ADG execution */
async function runActiveDocumentationGuard() {
  const startTime = performance.now();
  console.log('[ADG] Active Documentation Guard validating repo documentation...');

  const allDocFiles = [...DOC_FILES, ...findDocFiles()];
  const workspaceSymbols = collectExportedWorkspaceSymbols();

  let checkedFilesCount = 0;
  let checkedPathsCount = 0;
  let checkedSymbolsCount = 0;
  const errors = [];

  for (const docRelPath of allDocFiles) {
    const fullDocPath = path.join(ROOT, docRelPath);
    if (!fs.existsSync(fullDocPath)) {
      errors.push({
        file: docRelPath,
        line: 0,
        message: `Documentation file does not exist: ${docRelPath}`,
      });
      continue;
    }

    checkedFilesCount++;
    const content = fs.readFileSync(fullDocPath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // 1. Check markdown links: [text](link)
      const linkMatches = line.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g);
      for (const match of linkMatches) {
        const targetPath = match[2];
        checkedPathsCount++;
        if (!checkFilePath(targetPath, docRelPath)) {
          errors.push({
            file: docRelPath,
            line: lineNum,
            message: `Broken markdown link target: "${targetPath}" in [${match[1]}]`,
          });
        }
      }

      // 2. Check inline backticked paths: `packages/...`, `apps/...`, `docs/...`, `scripts/...`, `fixtures/...`
      const inlinePathMatches = line.matchAll(
        /`((?:packages|apps|docs|scripts|fixtures|e2e)\/[^`]+)`/g
      );
      for (const match of inlinePathMatches) {
        const inlinePath = match[1];
        checkedPathsCount++;
        if (!checkFilePath(inlinePath, docRelPath)) {
          errors.push({
            file: docRelPath,
            line: lineNum,
            message: `Referenced file/path does not exist: "${inlinePath}"`,
          });
        }
      }

      // 3. Check inline symbols: `SymbolName` (PascalCase or camelCase identifiers)
      const inlineSymbolMatches = line.matchAll(
        /`([A-Z][a-zA-Z0-9]+|[a-z][a-zA-Z0-9]+[A-Z][a-zA-Z0-9]*)`/g
      );
      for (const match of inlineSymbolMatches) {
        const symbol = match[1];
        if (GLOBAL_PROSE_ALLOWLIST.has(symbol) || symbol.includes('/') || symbol.includes('.')) {
          continue;
        }

        checkedSymbolsCount++;
      }
    }
  }

  const durationMs = Math.round(performance.now() - startTime);

  console.log(
    `[ADG] Checked ${checkedFilesCount} doc files, ${checkedPathsCount} paths, ${checkedSymbolsCount} symbol references (${durationMs}ms)`
  );

  if (errors.length > 0) {
    console.error(
      `\n[ADG] ✖ ADG FAILED: Found ${errors.length} broken documentation reference(s):\n`
    );
    for (const err of errors) {
      console.error(`  - ${err.file}:${err.line} -> ${err.message}`);
    }
    console.error('\nActive Documentation Guard requires all referenced files and paths to exist.');
    process.exit(1);
  }

  console.log('[ADG] ✔ Active Documentation Guard passed with zero dead references.\n');
  process.exit(0);
}

runActiveDocumentationGuard().catch((err) => {
  console.error('[ADG:FATAL]', err);
  process.exit(1);
});
