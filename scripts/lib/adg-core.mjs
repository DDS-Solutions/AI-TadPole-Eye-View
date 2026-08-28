import fs from 'node:fs';
import path from 'node:path';
import { validatePlanAndClaims } from './adg-claims.mjs';

export const DESIGNATED_ROOT_DOCS = Object.freeze([
  'AGENTS.md',
  'CHANGELOG.md',
  'DATA_SOURCES.md',
  'FOUR_PILLAR_ENVELOPE.md',
  'MASTER_PLAN_V3.md',
  'PLAN.md',
  'README.md',
  'RUNBOOK.md',
  'SECURITY.md',
  'THIRD_PARTY_NOTICES.md',
  'VERSION_CONTROL.md',
]);

const IGNORED_DIRS = new Set([
  '.git',
  '.tempmediaStorage',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
]);
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.svelte'];
const WORKSPACE_PATH_PREFIX = /^(?:apps|docs|e2e|fixtures|packages|scripts)\//;
const INLINE_PATH_PATTERN = /`((?:apps|docs|e2e|fixtures|packages|scripts)\/[^`]+)`/g;
const INLINE_SYMBOL_PATTERN = /`([A-Z][A-Za-z0-9_$]+|[a-z][A-Za-z0-9_$]*[A-Z][A-Za-z0-9_$]*)`/g;
const PROSE_SYMBOLS = new Set([
  'ADG',
  'ADSB',
  'AI',
  'AIS',
  'AOI',
  'AOIs',
  'Array',
  'CCTV',
  'CI',
  'CJS',
  'CSS',
  'DOM',
  'DX',
  'E2E',
  'Error',
  'ESM',
  'GEV',
  'GPS',
  'HTML',
  'HTTP',
  'HTTPS',
  'JSON',
  'Map',
  'MCP',
  'OS',
  'OTel',
  'Promise',
  'Record',
  'REST',
  'RPC',
  'SHA',
  'SPA',
  'SSE',
  'SSRF',
  'STASIS',
  'Set',
  'TLS',
  'TTL',
  'TaskRef',
  'UI',
  'URI',
  'URL',
  'USD',
  'Uint8Array',
  'WAL',
  'any',
  'boolean',
  'never',
  'null',
  'number',
  'string',
  'symbol',
  'taskRef',
  'undefined',
  'unknown',
  'void',
]);

function toRepoPath(value) {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function findMarkdownFiles(root, directory = path.join(root, 'docs')) {
  if (!fs.existsSync(directory)) return [];
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMarkdownFiles(root, fullPath));
    } else if (entry.name.endsWith('.md')) {
      results.push(toRepoPath(path.relative(root, fullPath)));
    }
  }
  return results.sort();
}

function readLines(filePath) {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
}

function addError(errors, file, line, message) {
  errors.push({ file: toRepoPath(file), line, message });
}

function cleanReference(reference) {
  const trimmed = reference.trim().replace(/^<|>$/g, '');
  const withoutAnchor = trimmed.split('#')[0];
  if (/^(?:https?:|mailto:)/i.test(withoutAnchor)) return null;

  const decoded = decodeURIComponent(withoutAnchor);
  const repoUriMatch = decoded.match(/(?:^|[\\/])AI-TadPole-Eye-View[\\/](.+)$/i);
  if (repoUriMatch?.[1]) return toRepoPath(repoUriMatch[1]);

  return toRepoPath(
    decoded
      .replace(/^file:\/\/\/?/i, '')
      .replace(/^[A-Za-z]:[\\/]/, '/')
      .replace(/^\//, '')
  );
}

function expandBraceReference(reference) {
  const match = reference.match(/^(.*)\{([^{}]+)\}(.*)$/);
  if (!match) return null;
  return match[2].split(',').map((part) => `${match[1]}${part.trim()}${match[3]}`);
}

function templatePrefix(reference) {
  const markerIndex = reference.search(/\*|\.\.\.|NNNN|<[^>]+>/);
  if (markerIndex < 0) return null;
  return reference.slice(0, markerIndex).replace(/\/$/, '');
}

function implementedCandidates(root, sourceFile, reference) {
  const candidates = [
    path.resolve(root, path.dirname(sourceFile), reference),
    path.resolve(root, reference),
  ];
  const moduleMatch = reference.match(/^(packages|apps)\/([^/]+)\/(.+)$/);
  if (moduleMatch && !path.extname(reference)) {
    const sourceBase = path.resolve(root, moduleMatch[1], moduleMatch[2], 'src', moduleMatch[3]);
    for (const extension of SOURCE_EXTENSIONS) candidates.push(`${sourceBase}${extension}`);
    for (const extension of SOURCE_EXTENSIONS) {
      candidates.push(path.join(sourceBase, `index${extension}`));
    }
  }
  return [...new Set(candidates)].filter((candidate) => isWithinRoot(root, candidate));
}

function resolveImplementedReference(root, sourceFile, rawReference) {
  const reference = cleanReference(rawReference);
  if (reference === null || reference === '') return { valid: true, reference };

  const braceReferences = expandBraceReference(reference);
  if (braceReferences) {
    const resolutions = braceReferences.map((item) =>
      resolveImplementedReference(root, sourceFile, item)
    );
    return {
      valid: resolutions.every((resolution) => resolution.valid),
      reference,
      resolvedPaths: resolutions.flatMap((resolution) => resolution.resolvedPaths ?? []),
      template: true,
    };
  }

  const prefix = templatePrefix(reference);
  if (prefix !== null) {
    const prefixCandidates = implementedCandidates(root, sourceFile, prefix || '.');
    return {
      valid: prefixCandidates.some((candidate) => fs.existsSync(candidate)),
      reference,
      template: true,
    };
  }

  const resolvedPaths = implementedCandidates(root, sourceFile, reference).filter((candidate) =>
    fs.existsSync(candidate)
  );
  return { valid: resolvedPaths.length > 0, reference, resolvedPaths };
}

function extractLineReferences(line) {
  const references = [];
  for (const match of line.matchAll(/\[([^\]]+)]\(([^)]+)\)/g)) {
    references.push({ index: match.index, label: match[1], raw: match[2], type: 'link' });
  }
  for (const match of line.matchAll(INLINE_PATH_PATTERN)) {
    references.push({ index: match.index, raw: match[1], type: 'inline' });
  }
  const seen = new Set();
  return references.filter((reference) => {
    const key = `${reference.type}:${reference.raw}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractPlannedMarkers(line) {
  return [...line.matchAll(/<!--\s*adg:planned-path\s+([^>]+?)\s*-->/gi)].map((match) =>
    toRepoPath(match[1].trim())
  );
}

function isConcreteWorkspacePath(reference) {
  return (
    WORKSPACE_PATH_PREFIX.test(reference) &&
    !reference.split('/').includes('..') &&
    !/[{}*<>]|\.\.\.|NNNN/.test(reference)
  );
}

function resolveSourceImport(sourceFile, specifier) {
  const base = path.resolve(path.dirname(sourceFile), specifier);
  const withoutJs = base.replace(/\.(?:m?js|jsx)$/, '');
  const candidates = [base, withoutJs];
  for (const extension of SOURCE_EXTENSIONS) candidates.push(`${withoutJs}${extension}`);
  for (const extension of SOURCE_EXTENSIONS) {
    candidates.push(path.join(withoutJs, `index${extension}`));
  }
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function exportedSymbolsFromFile(filePath, cache, visiting = new Set()) {
  if (cache.has(filePath)) return cache.get(filePath);
  if (visiting.has(filePath)) return new Set();
  visiting.add(filePath);
  const symbols = new Set();
  const code = fs.readFileSync(filePath, 'utf8');

  for (const match of code.matchAll(
    /export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g
  )) {
    symbols.add(match[1]);
  }
  for (const match of code.matchAll(/export\s*\{([^}]+)\}(?:\s+from\s+['"]([^'"]+)['"])?/g)) {
    for (const item of match[1].split(',')) {
      const cleaned = item.trim().replace(/^type\s+/, '');
      const [original, alias] = cleaned.split(/\s+as\s+/);
      if (!match[2]) symbols.add((alias ?? original).trim());
    }
    if (match[2]) {
      const target = resolveSourceImport(filePath, match[2]);
      if (target) {
        const targetSymbols = exportedSymbolsFromFile(target, cache, visiting);
        for (const item of match[1].split(',')) {
          const cleaned = item.trim().replace(/^type\s+/, '');
          const [original, alias] = cleaned.split(/\s+as\s+/);
          if (targetSymbols.has(original.trim())) symbols.add((alias ?? original).trim());
        }
      }
    }
  }
  for (const match of code.matchAll(/export\s+\*\s+from\s+['"]([^'"]+)['"]/g)) {
    const target = resolveSourceImport(filePath, match[1]);
    if (!target) continue;
    for (const symbol of exportedSymbolsFromFile(target, cache, visiting)) symbols.add(symbol);
  }
  visiting.delete(filePath);
  cache.set(filePath, symbols);
  return symbols;
}

function exportedSymbolsFromModule(modulePath, cache) {
  if (fs.statSync(modulePath).isFile()) return exportedSymbolsFromFile(modulePath, cache);
  const symbols = new Set();
  const scan = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (IGNORED_DIRS.has(entry.name) || entry.name === 'test' || entry.name === 'tests') continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) scan(fullPath);
      else if (
        SOURCE_EXTENSIONS.includes(path.extname(entry.name)) &&
        !entry.name.endsWith('.d.ts')
      ) {
        for (const symbol of exportedSymbolsFromFile(fullPath, cache)) symbols.add(symbol);
      }
    }
  };
  scan(modulePath);
  return symbols;
}

function symbolCandidatesForReference(line, reference) {
  const candidates = [];
  const linkLabel = reference.label?.replace(/^`|`$/g, '');
  if (
    reference.type === 'link' &&
    /^[A-Z][A-Za-z0-9$]+$/.test(linkLabel) &&
    !PROSE_SYMBOLS.has(linkLabel)
  ) {
    candidates.push(linkLabel);
  }
  const prefix = line.slice(0, reference.index);
  if (/\bin\s*$/i.test(prefix)) {
    const clauseStart = Math.max(prefix.lastIndexOf('. '), prefix.lastIndexOf(';')) + 1;
    const clause = prefix.slice(clauseStart);
    for (const match of clause.matchAll(INLINE_SYMBOL_PATTERN)) {
      if (
        /^[A-Z][A-Za-z0-9$]+$/.test(match[1]) &&
        !/^[A-Z0-9_]+$/.test(match[1]) &&
        !PROSE_SYMBOLS.has(match[1])
      ) {
        candidates.push(match[1]);
      }
    }
  }
  return [...new Set(candidates)];
}

export function runActiveDocumentationGuard({ root }) {
  const startTime = performance.now();
  const normalizedRoot = path.resolve(root);
  const errors = [];
  const rootDocs = DESIGNATED_ROOT_DOCS.map(toRepoPath);
  const docFiles = [...new Set([...rootDocs, ...findMarkdownFiles(normalizedRoot)])].sort();
  const symbolCache = new Map();
  let checkedFiles = 0;
  let checkedPaths = 0;
  let checkedSymbols = 0;

  for (const docFile of docFiles) {
    const fullPath = path.join(normalizedRoot, docFile);
    if (!fs.existsSync(fullPath)) {
      addError(errors, docFile, 0, `Designated documentation file does not exist: ${docFile}`);
      continue;
    }
    checkedFiles++;
    const lines = readLines(fullPath);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const lineNumber = index + 1;
      const references = extractLineReferences(line);
      const markers = extractPlannedMarkers(line);
      const missingMarked = new Set();
      const sourceModules = [];

      for (const reference of references) {
        const resolution = resolveImplementedReference(normalizedRoot, docFile, reference.raw);
        if (resolution.reference === null || resolution.reference === '') continue;
        const ambiguousDocSlug =
          reference.type === 'inline' &&
          /^docs\/[^/.]+$/.test(resolution.reference) &&
          !resolution.valid &&
          !markers.includes(resolution.reference);
        if (ambiguousDocSlug) continue;
        checkedPaths++;
        const planned = markers.includes(resolution.reference);
        if (!resolution.valid && planned) missingMarked.add(resolution.reference);
        else if (!resolution.valid) {
          addError(
            errors,
            docFile,
            lineNumber,
            `${reference.type === 'link' ? 'Broken markdown link target' : 'Referenced file/path does not exist'}: "${reference.raw}"`
          );
        }
        if (resolution.valid && !resolution.template) {
          for (const resolvedPath of resolution.resolvedPaths ?? []) {
            if (
              fs.statSync(resolvedPath).isDirectory() ||
              SOURCE_EXTENSIONS.includes(path.extname(resolvedPath))
            ) {
              sourceModules.push({
                lineReference: reference,
                path: resolvedPath,
                reference: resolution.reference,
              });
            }
          }
        }
      }

      for (const marker of markers) {
        if (!isConcreteWorkspacePath(marker) || !missingMarked.has(marker)) {
          addError(
            errors,
            docFile,
            lineNumber,
            `Planned-path marker must exactly match one missing concrete workspace path on the same line: "${marker}"`
          );
        }
      }

      const checkedReferences = new Set();
      for (const sourceModule of sourceModules) {
        const referenceKey = `${sourceModule.lineReference.type}:${sourceModule.lineReference.raw}`;
        if (checkedReferences.has(referenceKey)) continue;
        checkedReferences.add(referenceKey);
        const declaredModules = sourceModules.filter(
          (module) =>
            module.lineReference.type === sourceModule.lineReference.type &&
            module.lineReference.raw === sourceModule.lineReference.raw
        );
        for (const symbol of symbolCandidatesForReference(line, sourceModule.lineReference)) {
          checkedSymbols++;
          const member = declaredModules.some(({ path: modulePath }) =>
            exportedSymbolsFromModule(modulePath, symbolCache).has(symbol)
          );
          if (!member) {
            addError(
              errors,
              docFile,
              lineNumber,
              `Exported symbol "${symbol}" is not a member of declared module(s): ${[
                ...new Set(declaredModules.map((module) => module.reference)),
              ].join(', ')}`
            );
          }
        }
      }
    }
  }

  validatePlanAndClaims(normalizedRoot, errors);
  errors.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.message.localeCompare(right.message)
  );
  return {
    ok: errors.length === 0,
    errors,
    checkedFiles,
    checkedPaths,
    checkedSymbols,
    durationMs: Math.round(performance.now() - startTime),
  };
}

export function formatAdgReport(report) {
  const lines = [
    '[ADG] Active Documentation Guard validating repo documentation...',
    `[ADG] Checked ${report.checkedFiles} doc files, ${report.checkedPaths} paths, ${report.checkedSymbols} module-qualified symbol references (${report.durationMs}ms)`,
  ];
  if (report.ok) {
    lines.push('[ADG] ✔ Active Documentation Guard passed with zero integrity errors.');
    return lines.join('\n');
  }
  lines.push(
    '',
    `[ADG] ✖ ADG FAILED: Found ${report.errors.length} documentation integrity error(s):`,
    ''
  );
  for (const error of report.errors) {
    lines.push(`  - ${error.file}:${error.line} -> ${error.message}`);
  }
  return lines.join('\n');
}
