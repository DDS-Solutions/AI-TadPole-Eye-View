import fs from 'node:fs';
import path from 'node:path';
import { GOVERNANCE_SCHEMA_VERSION, inspectAuditIntegrity } from '@gev/governance';
import pc from 'picocolors';

export interface DoctorCheckResult {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  node_version: string;
  seed_mode: boolean;
  schema_version: number;
  checks: DoctorCheckResult[];
}

export interface RunDoctorOptions {
  cwd?: string;
  dbPath?: string;
  json?: boolean;
}

function checkNodeVersion(): DoctorCheckResult {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  if (major >= 24) {
    return {
      id: 'node_version',
      label: 'Node.js runtime',
      status: 'pass',
      detail: `v${process.versions.node} (>= 24 required)`,
    };
  }
  return {
    id: 'node_version',
    label: 'Node.js runtime',
    status: 'fail',
    detail: `v${process.versions.node} detected; Node.js >= 24 is required`,
  };
}

function checkPlanParity(rootDir: string): DoctorCheckResult {
  const planPath = path.join(rootDir, 'PLAN.md');
  const mirrorPath = path.join(rootDir, 'MASTER_PLAN_V3.md');
  if (!fs.existsSync(planPath) || !fs.existsSync(mirrorPath)) {
    return {
      id: 'plan_mirror',
      label: 'Plan mirror parity',
      status: 'warn',
      detail: 'PLAN.md or MASTER_PLAN_V3.md not found in working directory',
    };
  }
  const planBytes = fs.readFileSync(planPath);
  const mirrorBytes = fs.readFileSync(mirrorPath);
  if (planBytes.equals(mirrorBytes)) {
    return {
      id: 'plan_mirror',
      label: 'Plan mirror parity',
      status: 'pass',
      detail: `PLAN.md and MASTER_PLAN_V3.md are byte-identical (${planBytes.length} bytes)`,
    };
  }
  return {
    id: 'plan_mirror',
    label: 'Plan mirror parity',
    status: 'fail',
    detail: 'DOC_BLOCKER: PLAN.md and MASTER_PLAN_V3.md differ',
  };
}

function checkFixtures(rootDir: string): DoctorCheckResult {
  const fixturesDir = path.join(rootDir, 'fixtures');
  if (!fs.existsSync(fixturesDir)) {
    return {
      id: 'seed_fixtures',
      label: 'Seed fixtures',
      status: 'warn',
      detail: 'fixtures/ directory not found in working directory',
    };
  }
  const files = fs.readdirSync(fixturesDir).filter((name) => name.endsWith('.json'));
  if (files.length === 0) {
    return {
      id: 'seed_fixtures',
      label: 'Seed fixtures',
      status: 'fail',
      detail: 'fixtures/ directory contains no JSON fixtures',
    };
  }
  return {
    id: 'seed_fixtures',
    label: 'Seed fixtures',
    status: 'pass',
    detail: `${files.length} deterministic JSON fixture files present`,
  };
}

function checkRuntimePosture(): DoctorCheckResult {
  const isProd = process.env.NODE_ENV === 'production';
  const hasCredentialKey = Boolean(process.env.GEV_CREDENTIAL_KEY?.trim());
  const seedMode = process.env.GEV_SEED_MODE !== '0' && process.env.GEV_LIVE_MODE !== '1';
  if (isProd && !hasCredentialKey) {
    return {
      id: 'runtime_posture',
      label: 'Runtime security posture',
      status: 'fail',
      detail: 'NODE_ENV=production requires GEV_CREDENTIAL_KEY (64-hex AES-256-GCM key)',
    };
  }
  return {
    id: 'runtime_posture',
    label: 'Runtime security posture',
    status: 'pass',
    detail: `${seedMode ? 'SEED MODE' : 'LIVE MODE'} · credential key ${hasCredentialKey ? 'configured' : 'dev fallback'}`,
  };
}

function checkGovernanceDb(dbPath?: string): DoctorCheckResult {
  if (!dbPath) {
    return {
      id: 'governance_db',
      label: 'Governance SQLite DB',
      status: 'pass',
      detail: `Schema v${GOVERNANCE_SCHEMA_VERSION} ready (pass --db-path to verify a specific file)`,
    };
  }
  if (!fs.existsSync(dbPath)) {
    return {
      id: 'governance_db',
      label: 'Governance SQLite DB',
      status: 'fail',
      detail: `Database path does not exist: ${dbPath}`,
    };
  }
  const integrity = inspectAuditIntegrity({ dbPath });
  if (integrity.status === 'valid') {
    return {
      id: 'governance_db',
      label: 'Governance SQLite DB',
      status: 'pass',
      detail: `Verified schema v${GOVERNANCE_SCHEMA_VERSION}, audit chain valid (${integrity.verified_entries} retained entries)`,
    };
  }
  return {
    id: 'governance_db',
    label: 'Governance SQLite DB',
    status: 'fail',
    detail: `Audit chain verification failed (${integrity.status}${integrity.failure_code ? `: ${integrity.failure_code}` : ''})`,
  };
}

export async function runDoctor(options: RunDoctorOptions = {}): Promise<DoctorReport> {
  const rootDir = options.cwd ?? process.cwd();
  const checks: DoctorCheckResult[] = [
    checkNodeVersion(),
    checkPlanParity(rootDir),
    checkFixtures(rootDir),
    checkRuntimePosture(),
    checkGovernanceDb(options.dbPath),
  ];

  const report: DoctorReport = {
    ok: checks.every((c) => c.status !== 'fail'),
    node_version: process.versions.node,
    seed_mode: process.env.GEV_SEED_MODE !== '0' && process.env.GEV_LIVE_MODE !== '1',
    schema_version: GOVERNANCE_SCHEMA_VERSION,
    checks,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  console.log('');
  console.log(pc.bold(pc.cyan('🩺 GEV v2 Environment & Governance Doctor')));
  console.log(pc.dim('───────────────────────────────────────────────────────'));
  for (const check of checks) {
    const badge =
      check.status === 'pass'
        ? pc.green('PASS')
        : check.status === 'warn'
          ? pc.yellow('WARN')
          : pc.red('FAIL');
    console.log(` ${badge}  ${pc.bold(check.label.padEnd(26))} ${check.detail}`);
  }
  console.log(pc.dim('───────────────────────────────────────────────────────'));
  console.log('');

  if (!report.ok) {
    process.exitCode = 1;
  }
  return report;
}
