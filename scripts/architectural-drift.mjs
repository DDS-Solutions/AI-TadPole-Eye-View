import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const INVENTORY_PATH = path.join(ROOT, 'docs', 'architecture', 'architectural-drift.json');
const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.js',
  '.mjs',
  '.py',
  '.rs',
  '.scss',
  '.svelte',
  '.ts',
  '.tsx',
]);
const SCAN_EXTENSIONS = new Set(['.cjs', '.js', '.mjs', '.svelte', '.ts', '.tsx']);
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
  'test-results',
]);
const VALID_CLASSIFICATIONS = new Set(['compliant', 'fixed', 'adr-exempt', 'follow-up']);
const COLOR_PATTERN = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi;
const WALL_CLOCK_PATTERNS = [
  /Date\.now\s*\(\s*\)/g,
  /new\s+Date\s*\(\s*\)/g,
  /performance\.now\s*\(\s*\)/g,
  /JulianDate\.now\s*\(\s*\)/g,
  /Temporal\.Now\b/g,
  /process\.hrtime\b/g,
];

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function walk(relativeRoot = '.') {
  const absoluteRoot = path.join(ROOT, relativeRoot);
  if (!existsSync(absoluteRoot)) return [];

  const files = [];
  for (const entry of readdirSync(absoluteRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const relativePath = path.join(relativeRoot, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(relativePath));
    } else if (entry.isFile()) {
      files.push(toPosix(relativePath.replace(/^\.\//, '')));
    }
  }
  return files.sort();
}

function read(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function countMatches(text, patterns) {
  let count = 0;
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    count += [...text.matchAll(pattern)].length;
  }
  return count;
}

function countLines(text) {
  if (text.length === 0) return 0;
  const lines = text.split(/\r?\n/).length;
  return /\r?\n$/.test(text) ? lines - 1 : lines;
}

function fingerprintValues(values) {
  const counts = new Map();
  for (const value of values) {
    const normalized = value.toLowerCase().replace(/\s+/g, ' ').trim();
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  const stable = [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function scanWallClock(allFiles) {
  return allFiles
    .filter((file) => SCAN_EXTENSIONS.has(path.extname(file)))
    .filter((file) => /^(apps|packages|scripts)\//.test(file))
    .filter((file) => !/(^|\/)(test|tests)(\/|$)|\.test\.[^.]+$/.test(file))
    .map((file) => ({ path: file, occurrences: countMatches(read(file), WALL_CLOCK_PATTERNS) }))
    .filter((entry) => entry.occurrences > 0)
    .sort((left, right) => left.path.localeCompare(right.path));
}

function scanLargeFiles(allFiles) {
  return allFiles
    .filter((file) => SOURCE_EXTENSIONS.has(path.extname(file)))
    .map((file) => ({ path: file, lines: countLines(read(file)) }))
    .filter((entry) => entry.lines > 500)
    .sort((left, right) => left.path.localeCompare(right.path));
}

function scanColors(allFiles) {
  return allFiles
    .filter((file) => /^(apps\/web\/src|packages\/cesium-kit\/src)\//.test(file))
    .filter((file) => SOURCE_EXTENSIONS.has(path.extname(file)))
    .map((file) => {
      const values = read(file).match(COLOR_PATTERN) ?? [];
      return {
        path: file,
        occurrences: values.length,
        fingerprint: fingerprintValues(values),
      };
    })
    .filter((entry) => entry.occurrences > 0)
    .sort((left, right) => left.path.localeCompare(right.path));
}

function packageManifests(allFiles) {
  return allFiles.filter((file) => file === 'package.json' || file.endsWith('/package.json'));
}

function scanDependencies(allFiles) {
  const dependencyRecords = [];
  const installedNames = new Set();
  for (const manifestPath of packageManifests(allFiles)) {
    const manifest = JSON.parse(read(manifestPath));
    for (const section of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      for (const [name, range] of Object.entries(manifest[section] ?? {})) {
        installedNames.add(name);
        if (name === 'cesium' || name === '@cesium/engine') {
          dependencyRecords.push({ path: manifestPath, section, name, range });
        }
      }
    }
  }

  const imports = { cesium: 0, '@cesium/engine': 0 };
  const importPattern = /(?:from\s+|import\s*\(\s*)['"](@cesium\/engine|cesium)['"]/g;
  for (const file of allFiles.filter((candidate) => SCAN_EXTENSIONS.has(path.extname(candidate)))) {
    for (const match of read(file).matchAll(importPattern)) {
      imports[match[1]] += 1;
    }
  }

  const stackPackages = {
    maplibre: installedNames.has('maplibre-gl'),
    tailwind: installedNames.has('tailwindcss'),
    redis: installedNames.has('redis') || installedNames.has('ioredis'),
    opentelemetry: [...installedNames].some((name) => name.startsWith('@opentelemetry/')),
    react: installedNames.has('react'),
    'shadcn-svelte': installedNames.has('shadcn-svelte'),
    'bits-ui': installedNames.has('bits-ui'),
    paneforge: installedNames.has('paneforge'),
    'svelte-sonner': installedNames.has('svelte-sonner'),
    'vite-plugin-pwa': installedNames.has('vite-plugin-pwa'),
    '@tanstack/svelte-virtual': installedNames.has('@tanstack/svelte-virtual'),
    uplot: installedNames.has('uplot'),
  };

  return {
    cesiumDirect: dependencyRecords.sort((left, right) =>
      `${left.path}:${left.name}`.localeCompare(`${right.path}:${right.name}`)
    ),
    cesiumImports: imports,
    stackPackages,
  };
}

function scanFalseClaims() {
  const checks = [
    ['docs/DESIGN.md', /Built with `shadcn-svelte`/],
    ['docs/DESIGN.md', /Managed via `paneforge`/],
    ['docs/DESIGN.md', /Managed via `svelte-sonner`/],
    ['DATA_SOURCES.md', /enforce dynamic rate-limits, Redis caching/],
    ['docs/data-sources/satellites.md', /Layer Status:\s*Production Parity/],
    ['docs/data-sources/satellites.md', /cached on disk\/Redis/],
    [
      'docs/adr/0025-performance-budgets-frame-harness-and-virtualized-telemetry.md',
      /PWA Shell & Offline Baseline/,
    ],
  ];
  return checks
    .filter(([file, pattern]) => pattern.test(read(file)))
    .map(([file, pattern]) => `${file}: stale claim matched ${pattern}`);
}

function scan() {
  const allFiles = walk();
  const dependencies = scanDependencies(allFiles);
  return {
    wallClock: scanWallClock(allFiles),
    largeFiles: scanLargeFiles(allFiles),
    colors: scanColors(allFiles),
    cesiumDirect: dependencies.cesiumDirect,
    cesiumImports: dependencies.cesiumImports,
    stackPackages: dependencies.stackPackages,
    falseClaims: scanFalseClaims(),
  };
}

function validateClassifications(entries, category, errors) {
  for (const entry of entries) {
    if (!VALID_CLASSIFICATIONS.has(entry.classification)) {
      errors.push(`${category}:${entry.path ?? entry.name}: invalid classification`);
    }
    if (entry.classification === 'follow-up' && (!entry.owner || !entry.gate)) {
      errors.push(`${category}:${entry.path ?? entry.name}: follow-up requires owner and gate`);
    }
    if (entry.classification === 'adr-exempt' && !entry.adr) {
      errors.push(`${category}:${entry.path ?? entry.name}: ADR exemption requires an ADR`);
    }
  }
}

function compareEntries(actual, expected, category, fields, errors) {
  const actualByPath = new Map(actual.map((entry) => [entry.path, entry]));
  const expectedByPath = new Map(expected.map((entry) => [entry.path, entry]));

  for (const [entryPath, actualEntry] of actualByPath) {
    const expectedEntry = expectedByPath.get(entryPath);
    if (!expectedEntry) {
      errors.push(`${category}:${entryPath}: unclassified finding`);
      continue;
    }
    for (const field of fields) {
      if (actualEntry[field] !== expectedEntry[field]) {
        errors.push(
          `${category}:${entryPath}: ${field} expected ${expectedEntry[field]}, found ${actualEntry[field]}`
        );
      }
    }
  }

  for (const entryPath of expectedByPath.keys()) {
    if (!actualByPath.has(entryPath)) {
      errors.push(
        `${category}:${entryPath}: classified finding is no longer present; reconcile inventory`
      );
    }
  }
}

function check(current) {
  if (!existsSync(INVENTORY_PATH)) {
    throw new Error(
      `Missing checked-in inventory: ${toPosix(path.relative(ROOT, INVENTORY_PATH))}`
    );
  }
  const inventory = JSON.parse(readFileSync(INVENTORY_PATH, 'utf8'));
  const errors = [];

  validateClassifications(inventory.wallClock, 'wallClock', errors);
  validateClassifications(inventory.largeFiles, 'largeFiles', errors);
  validateClassifications(inventory.colors, 'colors', errors);
  compareEntries(current.wallClock, inventory.wallClock, 'wallClock', ['occurrences'], errors);
  compareEntries(current.largeFiles, inventory.largeFiles, 'largeFiles', ['lines'], errors);
  compareEntries(
    current.colors,
    inventory.colors,
    'colors',
    ['occurrences', 'fingerprint'],
    errors
  );

  if (JSON.stringify(current.cesiumDirect) !== JSON.stringify(inventory.cesiumDirect)) {
    errors.push('cesiumDirect: manifest dependency set changed; measured ADR review required');
  }
  if (JSON.stringify(current.cesiumImports) !== JSON.stringify(inventory.cesiumImports)) {
    errors.push('cesiumImports: import surface changed; measured ADR review required');
  }
  if (JSON.stringify(current.stackPackages) !== JSON.stringify(inventory.stackPackages)) {
    errors.push('stackPackages: installed-stack truth changed; reconcile docs and inventory');
  }
  errors.push(...current.falseClaims);

  if (errors.length > 0) {
    console.error('[ARCH-DRIFT] Architectural drift check failed:');
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }

  const followUps = [...inventory.largeFiles, ...inventory.colors].filter(
    (entry) => entry.classification === 'follow-up'
  ).length;
  console.log(
    `[ARCH-DRIFT] checked ${current.wallClock.length} clock paths, ${current.largeFiles.length} large files, ${current.colors.length} color-bearing files, ${current.cesiumDirect.length} direct Cesium declarations, and ${Object.keys(current.stackPackages).length} stack items; ${followUps} bounded follow-ups remain.`
  );
}

const current = scan();
if (process.argv.includes('--snapshot')) {
  console.log(JSON.stringify(current, null, 2));
} else {
  check(current);
}
