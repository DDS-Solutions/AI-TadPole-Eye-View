import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GevEvents } from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { afterEach, describe, expect, it } from 'vitest';
import { UnavailableApprovalGate } from '../src/approvalGate.js';
import {
  M1M4ReadinessError,
  assertM1ToM3Prerequisites,
  inspectM1ToM3Readiness,
  verifyIndependentAuditChain,
} from '../src/m1M4Readiness.js';
import { createGovernanceRuntimeContext } from '../src/runtimeContext.js';
import {
  LocalM2ApprovalDemoGate,
  LocalSignedApprovalProvider,
  generateEd25519KeyPair,
} from '../src/signedApproval.js';

const BASE_EPOCH = 1_731_410_000_000;

describe('M1->M2->M3 Prerequisite Enforcement & Independent Audit Verification (Task 12.2)', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it('rejects demo/prompt/unavailable M2 approval gates fail-closed unless SignedApprovalGate is wired', () => {
    const clock = new FrozenClock(BASE_EPOCH);
    const unavailableCtx = createGovernanceRuntimeContext({
      clock,
      dbPath: ':memory:',
      approvalGate: new UnavailableApprovalGate(clock),
    });
    cleanups.push(() => unavailableCtx.close());

    const reportUnavailable = inspectM1ToM3Readiness(unavailableCtx);
    expect(reportUnavailable.ready).toBe(false);
    expect(reportUnavailable.m2_gate_kind).toBe('unavailable_gate');
    expect(() => assertM1ToM3Prerequisites(unavailableCtx)).toThrow(M1M4ReadinessError);

    const defaultPromptCtx = createGovernanceRuntimeContext({ clock, dbPath: ':memory:' });
    cleanups.push(() => defaultPromptCtx.close());
    expect(inspectM1ToM3Readiness(defaultPromptCtx).m2_gate_kind).toBe('prompt_gate');
    expect(() => assertM1ToM3Prerequisites(defaultPromptCtx)).toThrow(/SignedApprovalGate/);

    const demoCtx = createGovernanceRuntimeContext({
      clock,
      dbPath: ':memory:',
      approvalGate: new LocalM2ApprovalDemoGate({ clock }),
    });
    cleanups.push(() => demoCtx.close());

    const reportDemo = inspectM1ToM3Readiness(demoCtx);
    expect(reportDemo.ready).toBe(false);
    expect(reportDemo.m2_gate_kind).toBe('demo_gate');
    expect(() => assertM1ToM3Prerequisites(demoCtx)).toThrow(/SignedApprovalGate/);
  });

  it('passes M1->M3 prerequisites with file-backed SQLite + SignedApprovalGate and exposes connectionLifecycle', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-m1m4-readiness-'));
    const dbPath = path.join(dir, 'governance.sqlite');
    const clock = new FrozenClock(BASE_EPOCH);
    const keyPair = generateEd25519KeyPair();

    const ctx = createGovernanceRuntimeContext({
      clock,
      dbPath,
      capUsd: 5,
      signedApproval: {
        trustedKeys: [
          {
            signerId: 'human:ops-lead',
            keyId: 'ops-ed25519-v1',
            publicKeyPem: keyPair.publicKeyPem,
            status: 'active',
          },
        ],
        provider: new LocalSignedApprovalProvider({
          signerId: 'human:ops-lead',
          keyId: 'ops-ed25519-v1',
          privateKeyPem: keyPair.privateKeyPem,
          policy: 'approve_all',
          clock,
        }),
      },
    });
    cleanups.push(() => {
      ctx.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    expect(ctx.connectionLifecycle).toBeDefined();

    const report = assertM1ToM3Prerequisites(ctx, {
      requireSignedApprovalGate: true,
      requireSharedAuthority: true,
    });
    expect(report.ready).toBe(true);
    expect(report.m1_audit_valid).toBe(true);
    expect(report.m2_gate_kind).toBe('signed_approval_gate');
    expect(report.m3_authority.authoritative).toBe(true);
    expect(report.m3_stasis_active).toBe(false);

    // STASIS trip blocks M4 readiness fail-closed until human resume
    ctx.budgetGovernor.trip('BUDGET_BREACH', 'Task 12.2 trip check');
    expect(() => assertM1ToM3Prerequisites(ctx)).toThrow(M1M4ReadinessError);
    ctx.budgetGovernor.resume('human');
    expect(assertM1ToM3Prerequisites(ctx).ready).toBe(true);

    // Record paired audit.intent + audit.outcome and verify independent chain
    ctx.auditSink.intent({
      kind: GevEvents.AuditIntent,
      id: '11111111-1111-4111-8111-111111111111',
      ts: clock.iso(),
      actor: 'ai',
      action: 'tool.set_flag',
      target: 'opensky.enabled',
      params: { flag: 'opensky.enabled', enabled: false },
      task_ref: 'task-12-2',
    });
    ctx.auditSink.outcome({
      kind: GevEvents.AuditOutcome,
      intent_id: '11111111-1111-4111-8111-111111111111',
      ts: clock.iso(),
      status: 'ok',
      result: { updated: true },
    });

    const verified = verifyIndependentAuditChain(ctx.auditSink, {
      requiredActions: ['tool.set_flag'],
    });
    expect(verified.valid).toBe(true);
    expect(verified.orphan_outcomes).toEqual([]);
    expect(verified.missing_required_actions).toEqual([]);
  });
});
