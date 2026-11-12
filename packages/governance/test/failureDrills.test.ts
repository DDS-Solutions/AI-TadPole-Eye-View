import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type ApprovalRequest, TaskBrief } from '@gev/contracts';
import type { McpAuthorizationContext } from '@gev/contracts/mcp-authorization';
import { FrozenClock, GovernedToolExecutor } from '@gev/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LocalSignedApprovalProvider,
  type SignedApprovalProvider,
  type StasisEvent,
  createGovernanceRuntimeContext,
  generateEd25519KeyPair,
  signApprovalPayload,
  verifyIndependentAuditChain,
} from '../src/index.js';

const NOW = 1_731_430_000_000;

function makeAuth(): McpAuthorizationContext {
  const nowSec = Math.floor(NOW / 1000);
  return {
    actor: 'ai',
    role: 'ai_copilot',
    principal: 'svc:tadpole-drill',
    tenant_id: 'tenant-drill',
    client_id: 'tadpole-runtime',
    token_id: 'drill-jwt-1',
    issuer: 'https://auth.gev.local/',
    audience: 'http://127.0.0.1:3000/mcp',
    resource: 'http://127.0.0.1:3000/mcp',
    scopes: ['read.telemetry', 'write.flags'],
    issued_at_epoch_seconds: nowSec - 10,
    not_before_epoch_seconds: nowSec - 10,
    expires_at_epoch_seconds: nowSec + 240,
    task_ref: 'task-12-3-drill',
  };
}

describe('Task 12.3: Governance & Tadpole Seam Failure Drills', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it('Drill 1 & 2: rejects tampered Ed25519 signatures and replayed M2 nonces or CapTokens fail-closed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-drill-sig-'));
    const dbPath = path.join(dir, 'governance.sqlite');
    const clock = new FrozenClock(NOW);
    const trustedKeys = generateEd25519KeyPair();
    const rogueKeys = generateEd25519KeyPair();
    let mode: 'tampered_sig' | 'rogue_signer' | 'replay_nonce' | 'valid' = 'valid';
    let lastValidResponse: Awaited<ReturnType<SignedApprovalProvider['decide']>> | undefined;

    const provider: SignedApprovalProvider = {
      decide: async (request: ApprovalRequest) => {
        if (mode === 'replay_nonce' && lastValidResponse) {
          return lastValidResponse;
        }
        const decidedAt = clock.iso();
        const payload = {
          format: 'gev.m2.approval.v1' as const,
          request_id: request.id,
          intent_id: request.intent_id,
          decision: 'approved' as const,
          scopes: [...request.scopes].sort(),
          signer_id: 'human:drill-lead',
          key_id: 'drill-key-1',
          nonce: request.nonce,
          issued_at: decidedAt,
          decided_by: 'human' as const,
          decided_at: decidedAt,
          expires_at: request.expires_at,
        };
        const envelope = signApprovalPayload(
          payload,
          mode === 'rogue_signer' ? rogueKeys.privateKeyPem : trustedKeys.privateKeyPem
        );
        const result = {
          decision: 'approved' as const,
          signed_approval:
            mode === 'tampered_sig'
              ? { ...envelope, signature: `A${envelope.signature.slice(1)}` }
              : envelope,
        };
        if (mode === 'valid') {
          lastValidResponse = result;
        }
        return result;
      },
    };

    const ctx = createGovernanceRuntimeContext({
      clock,
      dbPath,
      capUsd: 5,
      signedApproval: {
        trustedKeys: [
          {
            signerId: 'human:drill-lead',
            keyId: 'drill-key-1',
            publicKeyPem: trustedKeys.publicKeyPem,
            status: 'active',
          },
        ],
        provider,
      },
    });
    cleanups.push(() => {
      ctx.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
    });

    let dispatchCount = 0;
    const executor = new GovernedToolExecutor({
      clock,
      auditSink: ctx.auditSink,
      budgetGovernor: ctx.budgetGovernor,
      budgetLedger: ctx.budgetLedger,
      approvalGate: ctx.approvalGate,
    });
    executor.register('set_flag', (input) => {
      dispatchCount += 1;
      return { flag: input.flag, enabled: input.enabled, updated: true };
    });

    // 1a. Tampered M2 signature -> APPROVAL_UNAVAILABLE, ledger refunded, zero dispatch
    mode = 'tampered_sig';
    const opTampered = crypto.randomUUID();
    const resTampered = await executor.execute(
      'set_flag',
      { flag: 'opensky.enabled', enabled: false },
      { operation_id: opTampered, capability_scopes: ['write.flags'] }
    );
    expect(resTampered.success).toBe(false);
    expect(resTampered.code).toBe('APPROVAL_UNAVAILABLE');
    expect(ctx.budgetLedger.lookup(opTampered)?.state).toBe('REFUNDED');
    expect(dispatchCount).toBe(0);

    // 1b. Rogue M2 signer -> APPROVAL_UNAVAILABLE, ledger refunded, zero dispatch
    mode = 'rogue_signer';
    const opRogue = crypto.randomUUID();
    const resRogue = await executor.execute(
      'set_flag',
      { flag: 'opensky.enabled', enabled: false },
      { operation_id: opRogue, capability_scopes: ['write.flags'] }
    );
    expect(resRogue.success).toBe(false);
    expect(ctx.budgetLedger.lookup(opRogue)?.state).toBe('REFUNDED');
    expect(dispatchCount).toBe(0);

    // 2a. Valid approval succeeds once, then replaying exact same signed envelope fails
    mode = 'valid';
    const opValid = crypto.randomUUID();
    const resValid = await executor.execute(
      'set_flag',
      { flag: 'opensky.enabled', enabled: false },
      { operation_id: opValid, capability_scopes: ['write.flags'] }
    );
    expect(resValid.success).toBe(true);
    expect(dispatchCount).toBe(1);

    mode = 'replay_nonce';
    const opReplay = crypto.randomUUID();
    const resReplay = await executor.execute(
      'set_flag',
      { flag: 'opensky.enabled', enabled: true },
      { operation_id: opReplay, capability_scopes: ['write.flags'] }
    );
    expect(resReplay.success).toBe(false);
    expect(ctx.budgetLedger.lookup(opReplay)?.state).toBe('REFUNDED');
    expect(dispatchCount).toBe(1);

    // 2b. CapToken tamper, revocation, and expiry fail closed
    const capToken = ctx.capabilityIssuer.issue('svc:tadpole-drill', ['write.flags'], 120);
    expect(ctx.capabilityIssuer.verify(`${capToken.token.slice(0, -4)}zzzz`)).toBeNull();
    ctx.capabilityIssuer.revoke(capToken);
    expect(ctx.capabilityIssuer.verify(capToken)).toBeNull();

    const expiringToken = ctx.capabilityIssuer.issue('svc:tadpole-drill', ['write.flags'], 10);
    clock.setTime(NOW + 11_000);
    expect(ctx.capabilityIssuer.verify(expiringToken)).toBeNull();
  });

  it('Drill 3: handles ledger timeout/IN_DOUBT, blocks retry/resume until human reconciliation, and recovers expired holds', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-drill-indoubt-'));
    const dbPath = path.join(dir, 'governance.sqlite');
    const clock = new FrozenClock(NOW);
    const keys = generateEd25519KeyPair();
    const stasisEvents: StasisEvent[] = [];

    const ctx = createGovernanceRuntimeContext({
      clock,
      dbPath,
      capUsd: 5,
      signedApproval: {
        trustedKeys: [
          {
            signerId: 'human:drill-lead',
            keyId: 'drill-key-1',
            publicKeyPem: keys.publicKeyPem,
            status: 'active',
          },
        ],
        provider: new LocalSignedApprovalProvider({
          signerId: 'human:drill-lead',
          keyId: 'drill-key-1',
          privateKeyPem: keys.privateKeyPem,
          policy: 'approve_all',
          clock,
        }),
      },
    });
    const unsub = ctx.budgetGovernor.subscribeStasis((ev) => stasisEvents.push(ev));
    cleanups.push(() => {
      unsub();
      ctx.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
    });

    const executor = new GovernedToolExecutor({
      clock,
      auditSink: ctx.auditSink,
      budgetGovernor: ctx.budgetGovernor,
      budgetLedger: ctx.budgetLedger,
      approvalGate: ctx.approvalGate,
    });
    let runs = 0;
    executor.register('set_flag', () => {
      runs += 1;
      throw new Error('Simulated downstream timeout after dispatch');
    });

    const opId = crypto.randomUUID();
    const res1 = await executor.execute(
      'set_flag',
      { flag: 'opensky.enabled', enabled: false },
      { operation_id: opId, capability_scopes: ['write.flags'] }
    );
    expect(res1.success).toBe(false);
    expect(res1.code).toBe('OPERATION_IN_DOUBT');
    expect(ctx.budgetLedger.lookup(opId)?.state).toBe('IN_DOUBT');
    expect(ctx.budgetGovernor.state().stasis_active).toBe(true);
    expect(stasisEvents.some((e) => e.kind === 'stasis.entered')).toBe(true);

    // Retry with the SAME operation_id refuses to redispatch
    const resRetry = await executor.execute(
      'set_flag',
      { flag: 'opensky.enabled', enabled: false },
      { operation_id: opId, capability_scopes: ['write.flags'] }
    );
    expect(resRetry.code).toBe('OPERATION_IN_DOUBT');
    expect(runs).toBe(1);

    // Human resume is blocked while IN_DOUBT operation remains unresolved
    expect(() => ctx.budgetGovernor.resume('human')).toThrow(/reconciliation/);

    // Human reconciles IN_DOUBT operation then resumes STASIS
    const reconIntentId = crypto.randomUUID();
    ctx.budgetLedger.reconcile(
      {
        operation_id: opId,
        resolution: 'refunded',
        actual_usd: null,
        evidence: {
          kind: 'local_log',
          reference: 'drill-recon-001',
          summary: 'Verified target flag remained unchanged after handler failure',
        },
        audit_intent: {
          kind: 'audit.intent',
          id: reconIntentId,
          ts: clock.iso(),
          actor: 'human',
          action: 'governance.budget.reconcile',
          target: opId,
          params: { resolution: 'refunded' },
          task_ref: 'task-12-3-drill',
        },
      },
      'human'
    );
    expect(ctx.budgetLedger.lookup(opId)?.state).toBe('REFUNDED');

    ctx.budgetGovernor.resume('human');
    expect(ctx.budgetGovernor.state().stasis_active).toBe(false);
    expect(stasisEvents.some((e) => e.kind === 'stasis.resumed')).toBe(true);

    // Expired reservation hold recovers cleanly to REFUNDED
    const expiredOpId = crypto.randomUUID();
    const expiredRes = ctx.budgetLedger.reserve({
      operation_id: expiredOpId,
      fingerprint_components: {
        contract_version: 'gev.m3.ledger.v1',
        fingerprint_version: 'gev.m3.fingerprint.v1',
        actor: 'ai',
        tenant_id: 'tenant-drill',
        action: 'tool.set_flag',
        input: { flag: 'opensky.enabled', enabled: true },
        task_ref: 'task-12-3-drill',
        is_mutating: true,
        estimate: { currency: 'usd', min: 0, max: 0.5 },
      },
      deadline_at: new Date(clock.now() + 5_000).toISOString(),
      audit_intent: {
        kind: 'audit.intent',
        id: expiredOpId,
        ts: clock.iso(),
        actor: 'ai',
        action: 'tool.set_flag',
        target: 'set_flag',
        params: { flag: 'opensky.enabled', enabled: true },
        task_ref: 'task-12-3-drill',
      },
    });
    expect(expiredRes.kind).toBe('reserved');

    clock.setTime(NOW + 6_000);
    const recovered = ctx.budgetLedger.recoverExpired();
    expect(recovered.refunded_operation_ids).toContain(expiredOpId);
    expect(ctx.budgetLedger.lookup(expiredOpId)?.state).toBe('REFUNDED');
  });

  it('Drill 4: budget breach emits immediate STASIS notification, suspends Tadpole sessions, and enforces human-only resume', () => {
    const clock = new FrozenClock(NOW);
    const keys = generateEd25519KeyPair();
    const events: StasisEvent[] = [];

    const ctx = createGovernanceRuntimeContext({
      clock,
      dbPath: ':memory:',
      capUsd: 1.0,
      signedApproval: {
        trustedKeys: [
          {
            signerId: 'human:drill-lead',
            keyId: 'drill-key-1',
            publicKeyPem: keys.publicKeyPem,
            status: 'active',
          },
        ],
        provider: new LocalSignedApprovalProvider({
          signerId: 'human:drill-lead',
          keyId: 'drill-key-1',
          privateKeyPem: keys.privateKeyPem,
          policy: 'approve_all',
          clock,
        }),
      },
    });
    const unsub = ctx.budgetGovernor.subscribeStasis((ev) => events.push(ev));
    cleanups.push(() => {
      unsub();
      ctx.close();
    });

    const brief = TaskBrief.parse({
      id: '12.3',
      title: 'Failure Drill Session',
      scope_contract: { in_scope: ['packages/governance'] },
      performance_threshold: ['STASIS within 1 cycle'],
      task_ref: 'task-12-3-drill',
    });
    const cap = ctx.capabilityIssuer.issue('svc:tadpole-drill', ['read.telemetry'], 240);
    const session = ctx.connectionLifecycle.openSession({
      transport: 'http-2026-07-28',
      authorization: makeAuth(),
      capToken: cap,
      taskBrief: brief,
    });
    expect(session.state).toBe('active');

    // Spend $0.90, then check $0.25 -> immediate BUDGET_BREACH STASIS + session suspension
    ctx.budgetGovernor.recordSpend(0.9);
    const verdict = ctx.budgetGovernor.check({
      action: 'provider.live_fetch',
      estimate: { currency: 'usd', min: 0.25, max: 0.25 },
    });
    expect(verdict.allowed).toBe(false);
    expect(ctx.connectionLifecycle.getSession(session.session_id)?.state).toBe('suspended_stasis');
    expect(events.filter((e) => e.kind === 'stasis.entered')).toHaveLength(1);

    // Non-human resume refused
    expect(() => ctx.budgetGovernor.resume('ai')).toThrow(/human actor/);
    expect(() => ctx.budgetGovernor.resume('system')).toThrow(/human actor/);

    // Human resume clears STASIS & emits notification
    ctx.budgetGovernor.resume('human');
    expect(ctx.budgetGovernor.state().stasis_active).toBe(false);
    expect(events.some((e) => e.kind === 'stasis.resumed' && e.resumed_by === 'human')).toBe(true);

    expect(verifyIndependentAuditChain(ctx.auditSink).valid).toBe(true);
  });
});
