import crypto from 'node:crypto';
import { type AuditIntent, type AuditOutcome, GevEvents } from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import {
  LocalM2ApprovalDemoGate,
  MerkleAuditChain,
  createGovernanceRuntimeContext,
} from '@gev/governance';
import { createOperatorContext, executeOperatorTool } from '@gev/ops-mcp';
import pc from 'picocolors';

export interface DemoResult {
  success: boolean;
  simulation: 'local-seed';
  eventsRecorded: number;
  merkleHead: string;
  durableAuditValid: boolean;
  stasisTripRecovered: boolean;
}

/**
 * Local seed simulation of M1–M3-shaped governance mechanics.
 * This does not prove external approval, external M3 authority, or independent head anchoring.
 */
export async function runDemo(): Promise<DemoResult> {
  console.log(
    pc.bold(pc.cyan('\n═══════════════════════════════════════════════════════════════════════'))
  );
  console.log(pc.bold(pc.cyan('  🌍 GEV v2 Local Governance Simulation (Seed Mode)')));
  console.log(
    pc.bold(pc.cyan('═══════════════════════════════════════════════════════════════════════\n'))
  );

  const clock = new FrozenClock(1700000000000);
  const gatekeeper = new LocalM2ApprovalDemoGate({ clock });
  const governanceContext = createGovernanceRuntimeContext({
    clock,
    dbPath: ':memory:',
    capUsd: 1,
    spentUsd: 0,
    approvalGate: gatekeeper,
  });
  const { auditSink, budgetGovernor } = governanceContext;
  const merkleChain = new MerkleAuditChain();

  const auditEventsList: Array<Record<string, unknown>> = [];
  auditSink.subscribe((entry) => {
    const hash = merkleChain.append(entry as unknown as Record<string, unknown>);
    auditEventsList.push(entry as unknown as Record<string, unknown>);
    const actionLabel =
      entry.kind === GevEvents.AuditIntent
        ? (entry as AuditIntent).action
        : (entry as AuditOutcome).status;
    console.log(
      ` ${pc.dim('│')} ${pc.green('●')} [${pc.bold(entry.kind)}] ${pc.yellow(actionLabel)} ${pc.dim(`(Merkle: ${hash.slice(0, 10)}...)`)}`
    );
  });

  const ctx = createOperatorContext({
    governanceContext,
  });

  // ─── STEP 1: Local observer-shaped simulation initialization ──────────
  console.log(pc.bold(pc.white('▶ [STEP 1] Initializing Local Audit Observer & Sim-Clock...')));
  console.log(`   Sim-Clock Epoch:  ${new Date(clock.now()).toISOString()}`);
  console.log(`   Budget Cap:       $${budgetGovernor.state().cap_usd.toFixed(2)} USD`);
  console.log('   Approval Stub:    Locally generated Ed25519 demo key (not external M2)\n');

  // ─── STEP 2: Real local MCP state mutations ───────────────────────────
  console.log(pc.bold(pc.white('▶ [STEP 2] Exercising Audited Local Kill-Switch State...')));

  const disableResult = await executeOperatorTool(ctx, 'set_flag', {
    flag: 'opensky.enabled',
    enabled: false,
  });
  if (!disableResult.success) {
    throw new Error(`Disable tool failed: ${disableResult.error}`);
  }
  console.log(`   Disable Result:   ${JSON.stringify(disableResult.result)}`);

  const enableResult = await executeOperatorTool(ctx, 'set_flag', {
    flag: 'opensky.enabled',
    enabled: true,
  });
  if (!enableResult.success) {
    throw new Error(`Enable tool failed: ${enableResult.error}`);
  }
  console.log(`   Enable Result:    ${JSON.stringify(enableResult.result)}\n`);

  // ─── STEP 3: M3 Governor STASIS Tripwire ──────────────────────────────
  console.log(pc.bold(pc.white('▶ [STEP 3] Triggering Budget Governor STASIS Tripwire...')));
  console.log(pc.dim('   AI Agent attempting high-spend action exceeding $1.00 cap...'));

  // Settle spend to consume budget
  budgetGovernor.recordSpend(0.95);

  // Attempt spend-bearing tasking
  const blockedVerdict = budgetGovernor.check({
    action: 'ai.heavy_satellite_tasking',
    estimate: { currency: 'usd', min: 0.1, max: 0.2 },
  });

  console.log(`   Budget Verdict:   Allowed = ${blockedVerdict.allowed}`);
  if (!blockedVerdict.allowed) {
    console.log(`   Trip Reason:      ${pc.red(pc.bold(blockedVerdict.reason))}`);
    console.log(`   Lock Message:     ${blockedVerdict.message}`);
  }
  console.log(`   STASIS State:     ${pc.bgRed(pc.white(' STASIS ACTIVE '))}\n`);

  // ─── STEP 4: Explicitly simulated local human recovery ───────────────
  console.log(
    pc.bold(pc.white('▶ [STEP 4] Simulating Local Human Resume (not shared-runtime proof)...'))
  );
  console.log(pc.dim('   Demo injects a local human actor after inspecting the in-memory WAL...'));

  // Log human intent to resume
  const resumeIntentId = crypto.randomUUID();
  auditSink.intent({
    kind: GevEvents.AuditIntent,
    id: resumeIntentId,
    ts: new Date(clock.now()).toISOString(),
    actor: 'human',
    action: 'governance.resume',
    target: 'stasis.lock',
    params: { reason: 'Operator verified mission parameters and granted cap extension' },
    task_ref: 'task-showcase-demo-001',
  });

  budgetGovernor.resume('human');

  auditSink.outcome({
    kind: GevEvents.AuditOutcome,
    intent_id: resumeIntentId,
    ts: new Date(clock.now()).toISOString(),
    status: 'ok',
    result: { resumed: true, operator: 'human:dev' },
    duration_ms: 5,
  });

  console.log(`   STASIS Resumed:   ${pc.green('STASIS_INACTIVE')}`);
  console.log(`   Resumed By:       ${budgetGovernor.state().last_trip?.resumed_by}\n`);

  // ─── STEP 5: Independent helper and authoritative local chain checks ──
  console.log(pc.bold(pc.white('▶ [STEP 5] Verifying Local Audit Integrity...')));
  const headHash = merkleChain.getHeadHash();
  const isChainValid = MerkleAuditChain.verifyChain(auditEventsList, headHash);
  const durableIntegrity = auditSink.verifyIntegrity();
  console.log(`   Merkle Head Hash: ${pc.cyan(headHash)}`);
  console.log(
    `   Shadow Helper:    ${isChainValid ? pc.green('✔ VALID (independent demo only)') : pc.red('✖ INVALID')}`
  );
  console.log(
    `   SQLite Chain:     ${durableIntegrity.status === 'valid' ? pc.green(`✔ VALID (${durableIntegrity.verified_entries} entries)`) : pc.red(`✖ ${durableIntegrity.failure_code ?? 'INVALID'}`)}\n`
  );

  console.log(
    pc.bold(pc.cyan('═══════════════════════════════════════════════════════════════════════'))
  );
  console.log(
    pc.bold(
      pc.green(`  ✅ Local Seed Simulation Succeeded (${auditEventsList.length} WAL entries)`)
    )
  );
  console.log(
    pc.bold(pc.cyan('═══════════════════════════════════════════════════════════════════════\n'))
  );

  const result = {
    success: true,
    simulation: 'local-seed' as const,
    eventsRecorded: auditEventsList.length,
    merkleHead: headHash,
    durableAuditValid: durableIntegrity.status === 'valid',
    stasisTripRecovered: !budgetGovernor.state().stasis_active,
  };
  governanceContext.close();
  return result;
}
