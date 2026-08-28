import fs from 'node:fs';
import path from 'node:path';

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function addError(errors, file, line, message) {
  errors.push({ file, line, message });
}

function readLines(filePath) {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
}

function parseCheckpoint(planLines, errors) {
  const checkpoint = new Map();
  const lineNumbers = new Map();
  for (let index = 0; index < planLines.length; index++) {
    const match = planLines[index].match(/^([A-Z][A-Z0-9_]+)=(.+)$/);
    if (!match) continue;
    checkpoint.set(match[1], match[2].trim());
    lineNumbers.set(match[1], index + 1);
  }
  for (const key of ['PLAN_VERSION', 'CURRENT_PHASE', 'NEXT_TASK', 'NEXT_TASK_STATUS']) {
    if (!checkpoint.has(key)) addError(errors, 'PLAN.md', 1, `Missing checkpoint claim: ${key}`);
  }
  return { checkpoint, lineNumbers };
}

function firstMatchLine(lines, pattern) {
  const index = lines.findIndex((line) => pattern.test(line));
  return index < 0 ? 1 : index + 1;
}

function validateRootPhaseClaims(root, currentPhase, errors) {
  for (const claim of [
    { file: 'README.md', pattern: /badge\/phase-(\d+(?:\.\d+)?)/i },
    { file: 'SECURITY.md', pattern: /\*\*Status:\*\*\s*Phase\s+(\d+(?:\.\d+)?)/i },
  ]) {
    const filePath = path.join(root, claim.file);
    if (!fs.existsSync(filePath) || !currentPhase) continue;
    const lines = readLines(filePath);
    const index = lines.findIndex((line) => claim.pattern.test(line));
    const value = index >= 0 ? lines[index].match(claim.pattern)?.[1] : undefined;
    if (value !== currentPhase) {
      addError(
        errors,
        claim.file,
        index < 0 ? 1 : index + 1,
        `Stale current-phase claim: expected ${currentPhase}, found ${value ?? 'missing'}`
      );
    }
  }
}

function validateCliPhaseClaim(root, currentPhase, errors) {
  const sourceFile = 'packages/cli/src/commands/status.ts';
  const sourcePath = path.join(root, sourceFile);
  if (!fs.existsSync(sourcePath) || !currentPhase) return;
  const lines = readLines(sourcePath);
  const pattern = /export const PROJECT_PHASE = ['"]Phase (\d+(?:\.\d+)?)(?:\s|—)/;
  const index = lines.findIndex((line) => pattern.test(line));
  const value = index >= 0 ? lines[index].match(pattern)?.[1] : undefined;
  if (value !== currentPhase) {
    addError(
      errors,
      sourceFile,
      index < 0 ? 1 : index + 1,
      `Stale CLI phase claim: expected ${currentPhase}, found ${value ?? 'missing'}`
    );
  }
}

function validateProductVersion(root, errors) {
  const packagePath = path.join(root, 'package.json');
  if (!fs.existsSync(packagePath)) {
    addError(errors, 'package.json', 1, 'Canonical product-version source is missing');
    return;
  }
  const packageVersion = JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
  if (typeof packageVersion !== 'string' || !SEMVER_PATTERN.test(packageVersion)) {
    addError(
      errors,
      'package.json',
      1,
      `Canonical product version is not valid SemVer: ${String(packageVersion)}`
    );
    return;
  }
  const changelogPath = path.join(root, 'CHANGELOG.md');
  if (!fs.existsSync(changelogPath)) return;
  const changelogLines = readLines(changelogPath);
  const index = changelogLines.findIndex((line) => /^## \[\d+\.\d+\.\d+/.test(line));
  const changelogVersion = changelogLines[index]?.match(/^## \[([^\]]+)]/)?.[1];
  if (changelogVersion !== packageVersion) {
    addError(
      errors,
      'CHANGELOG.md',
      index < 0 ? 1 : index + 1,
      `Stale product-version claim: expected ${packageVersion}, found ${changelogVersion ?? 'missing'}`
    );
  }
}

export function validatePlanAndClaims(root, errors) {
  const planPath = path.join(root, 'PLAN.md');
  const mirrorPath = path.join(root, 'MASTER_PLAN_V3.md');
  if (!fs.existsSync(planPath) || !fs.existsSync(mirrorPath)) return;
  const planContent = fs.readFileSync(planPath, 'utf8');
  const mirrorContent = fs.readFileSync(mirrorPath, 'utf8');
  if (planContent !== mirrorContent) {
    addError(errors, 'MASTER_PLAN_V3.md', 1, 'Plan mirror differs byte-for-byte from PLAN.md');
  }

  const planLines = planContent.split(/\r?\n/);
  const { checkpoint, lineNumbers } = parseCheckpoint(planLines, errors);
  const planVersion = checkpoint.get('PLAN_VERSION');
  const currentPhase = checkpoint.get('CURRENT_PHASE');
  const nextTask = checkpoint.get('NEXT_TASK');
  const nextStatus = checkpoint.get('NEXT_TASK_STATUS');
  const metadataVersion = planLines
    .find((line) => /^\*\*Plan version:\*\*/.test(line))
    ?.replace(/^\*\*Plan version:\*\*\s*/, '')
    .trim();
  if (planVersion && metadataVersion !== planVersion) {
    addError(
      errors,
      'PLAN.md',
      firstMatchLine(planLines, /^\*\*Plan version:/),
      `Stale plan version claim: expected ${planVersion}, found ${metadataVersion ?? 'missing'}`
    );
  }

  const unchecked = planLines
    .map((line) => line.match(/^- \[ \]\s+(?:\*\*)?(\d+(?:\.\d+){1,2}[a-z]?(?:\s+exit)?)(?:\b|:)/i))
    .find(Boolean);
  const firstUnchecked = unchecked?.[1];
  if (firstUnchecked && nextTask !== firstUnchecked) {
    addError(
      errors,
      'PLAN.md',
      lineNumbers.get('NEXT_TASK') ?? 1,
      `Stale NEXT_TASK claim: expected first unchecked task ${firstUnchecked}, found ${nextTask ?? 'missing'}`
    );
  }
  if (firstUnchecked && !['READY', 'BLOCKED'].includes(nextStatus)) {
    addError(
      errors,
      'PLAN.md',
      lineNumbers.get('NEXT_TASK_STATUS') ?? 1,
      `Stale NEXT_TASK_STATUS claim: ${firstUnchecked} is unchecked but status is ${nextStatus ?? 'missing'}`
    );
  }
  if (firstUnchecked && currentPhase) {
    const taskPhase = firstUnchecked.match(/^\d+\.\d+/)?.[0];
    if (taskPhase && taskPhase !== currentPhase) {
      addError(
        errors,
        'PLAN.md',
        lineNumbers.get('CURRENT_PHASE') ?? 1,
        `Stale CURRENT_PHASE claim: expected ${taskPhase} from ${firstUnchecked}, found ${currentPhase}`
      );
    }
  }

  const statusLineNumber = firstMatchLine(planLines, /^\*\*Status:\*\*/);
  const statusLine = planLines[statusLineNumber - 1] ?? '';
  if (firstUnchecked && !/^\*\*Status:\*\*\s+IN PROGRESS\b/.test(statusLine)) {
    addError(
      errors,
      'PLAN.md',
      statusLineNumber,
      'Plan has unchecked tasks but status is not IN PROGRESS'
    );
  }
  if (currentPhase && !statusLine.includes(`Phase ${currentPhase}`)) {
    addError(
      errors,
      'PLAN.md',
      statusLineNumber,
      `Stale phase claim in plan status: expected Phase ${currentPhase}`
    );
  }

  validateRootPhaseClaims(root, currentPhase, errors);
  validateCliPhaseClaim(root, currentPhase, errors);
  validateProductVersion(root, errors);
}
