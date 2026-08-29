#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { Command } from 'commander';
import { runAuditTail, runAuditVerify } from './commands/audit.js';
import { runBudgetReconcile } from './commands/budget.js';
import { runDemo } from './commands/demo.js';
import { runFeedsHealth } from './commands/feeds.js';
import { runResume } from './commands/resume.js';
import { runSceneLoad, runSceneSave } from './commands/scene.js';
import { runStatus } from './commands/status.js';

export const program = new Command();

program
  .name('gev')
  .description("God's Eye View v2 (GEV) — Operator & Agent CLI Surface")
  .version('0.1.0');

// 0. gev demo
program
  .command('demo')
  .description('Run live Governed Agent Team showcase demonstration (PLAN.md §10 Phase 4)')
  .action(async () => {
    await runDemo();
  });

// 1. gev status
program
  .command('status')
  .description('Display system phase, STASIS lock state, budget, and feed health')
  .option('--json', 'Output raw JSON')
  .option('--server-url <url>', 'Override GEV server URL', 'http://localhost:3000')
  .action(async (options) => {
    await runStatus(options);
  });

// 2. gev feeds [health]
const feeds = program.command('feeds').description('Provider telemetry feed operations');
feeds
  .command('health')
  .description('Check registry-derived health, mode, and implementation status for all feeds')
  .action(async () => {
    await runFeedsHealth();
  });

// 3. gev audit [tail]
const audit = program.command('audit').description('Governance audit WAL inspection');
audit
  .command('tail')
  .description('Tail recent mutating actions, intent/outcome pairs, and STASIS trips')
  .option(
    '-n, --limit <number>',
    'Number of records to show',
    (val) => Number.parseInt(val, 10),
    20
  )
  .option('-t, --task-ref <string>', 'Filter by Task Reference')
  .action(async (options) => {
    await runAuditTail({ limit: options.limit, taskRef: options.taskRef });
  });
audit
  .command('verify')
  .description('Verify the durable versioned audit chain without repairing it')
  .option('--server-url <url>', 'Override GEV server URL', 'http://localhost:3000')
  .option('--db-path <path>', 'Inspect an explicit local governance database when offline')
  .action(async (options) => {
    await runAuditVerify({ serverUrl: options.serverUrl, dbPath: options.dbPath });
  });

// 4. gev scene <load|save>
const scene = program.command('scene').description('Globe scene serialization and reproduction');
scene
  .command('load <file>')
  .description('Load and validate a serialized scene JSON file')
  .action(async (file) => {
    await runSceneLoad(file);
  });
scene
  .command('save [file]')
  .description('Export current/default globe scene to a JSON file')
  .action(async (file) => {
    await runSceneSave(file);
  });

// 5. gev resume
program
  .command('resume [reason]')
  .description('Human operator override to resume system from STASIS lock (PLAN.md §0)')
  .action(async (reason) => {
    await runResume(reason);
  });

// 6. gev budget reconcile
const budget = program.command('budget').description('Durable M3 budget-ledger operations');
budget
  .command('reconcile <operation-id>')
  .description('Human-only reconciliation of an ambiguous operation; does not resume STASIS')
  .option('--settled-usd <amount>', 'Settle with the verified actual USD amount', Number)
  .option('--refunded', 'Refund after verifying no effect and no charge')
  .requiredOption('--summary <text>', 'Bounded human reconciliation evidence')
  .option(
    '--evidence-kind <kind>',
    'operator_attestation, provider_receipt, or local_log',
    'operator_attestation'
  )
  .option('--reference <id>', 'Bounded receipt/log identifier (not a filesystem path)')
  .option('--server-url <url>', 'Override GEV server URL', 'http://localhost:3000')
  .action(async (operationId, options) => {
    await runBudgetReconcile(operationId, options);
  });

// 7. gev dev
program
  .command('dev')
  .description('Start local development servers (Vite web + Hono server)')
  .action(() => {
    const proc = spawn('pnpm', ['turbo', 'run', 'dev'], { stdio: 'inherit', shell: true });
    proc.on('exit', (code) => {
      process.exit(code ?? 0);
    });
  });

// 8. gev test
program
  .command('test')
  .description('Run unit and property test suites across all monorepo packages')
  .action(() => {
    const proc = spawn('pnpm', ['test'], { stdio: 'inherit', shell: true });
    proc.on('exit', (code) => {
      process.exit(code ?? 0);
    });
  });

// 9. gev qa
program
  .command('qa')
  .description('Run Playwright E2E smoke tests')
  .action(() => {
    const proc = spawn('pnpm', ['e2e'], { stdio: 'inherit', shell: true });
    proc.on('exit', (code) => {
      process.exit(code ?? 0);
    });
  });

program.parseAsync(process.argv).catch((err) => {
  console.error('CLI Error:', err);
  process.exit(1);
});
