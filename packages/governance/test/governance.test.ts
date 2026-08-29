import crypto from 'node:crypto';
import { GevEvents } from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { PromptApprovalGate } from '../src/approvalGate.js';
import { SqliteAuditSink } from '../src/auditSink.js';
import { CapBudgetGovernor } from '../src/budgetGovernor.js';

describe('Governance Port Stubs (@gev/governance)', () => {
  let clock: FrozenClock;

  beforeEach(() => {
    clock = new FrozenClock(1700000000000);
  });

  describe('SqliteAuditSink (WAL mode & Rule 1 ordering)', () => {
    it('records intent before execution and outcome after execution', async () => {
      const sink = new SqliteAuditSink({ clock, dbPath: ':memory:' });
      const intentId = crypto.randomUUID();
      const tsIntent = new Date(clock.now()).toISOString();

      // 1. Log intent before action
      sink.intent({
        kind: GevEvents.AuditIntent,
        id: intentId,
        ts: tsIntent,
        actor: 'ai',
        action: 'camera.reposition',
        target: 'globe.camera',
        params: { lat: 40.7128, lon: -74.006 },
        task_ref: 'brief-governance-001',
      });

      // Verify intent is recorded immediately in SQLite
      let records = sink.tail();
      expect(records.length).toBe(1);
      expect(records[0]?.kind).toBe(GevEvents.AuditIntent);
      expect(records[0]?.task_ref).toBe('brief-governance-001');

      // Advance clock
      clock.setTime(1700000000150);
      const tsOutcome = new Date(clock.now()).toISOString();

      // 2. Log outcome after action
      sink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: tsOutcome,
        status: 'ok',
        result: { arrived: true },
        duration_ms: 150,
      });

      // Verify outcome record is added sequentially
      records = sink.tail();
      expect(records.length).toBe(2);
      expect(records[1]?.kind).toBe(GevEvents.AuditOutcome);
      expect(records[1]?.status).toBe('ok');
      expect(records[1]?.intent_id).toBe(intentId);
      expect(records[1]?.duration_ms).toBe(150);

      sink.close();
    });

    it('tails audit records filtered by task reference', async () => {
      const sink = new SqliteAuditSink({ clock, dbPath: ':memory:' });
      const id1 = crypto.randomUUID();
      const id2 = crypto.randomUUID();

      sink.intent({
        kind: GevEvents.AuditIntent,
        id: id1,
        ts: new Date(clock.now()).toISOString(),
        actor: 'system',
        action: 'ops.load',
        target: 'layer.flights',
        task_ref: 'task-alpha',
      });
      sink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: id1,
        ts: new Date(clock.now()).toISOString(),
        status: 'ok',
      });

      sink.intent({
        kind: GevEvents.AuditIntent,
        id: id2,
        ts: new Date(clock.now()).toISOString(),
        actor: 'human',
        action: 'ops.reload',
        target: 'layer.weather',
        task_ref: 'task-beta',
      });
      sink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: id2,
        ts: new Date(clock.now()).toISOString(),
        status: 'blocked',
        error: 'Rate limit exceeded',
      });

      const alphaRecords = sink.tailByTaskRef('task-alpha');
      expect(alphaRecords.length).toBe(2);
      expect(alphaRecords[0]?.task_ref).toBe('task-alpha');

      const betaRecords = sink.tailByTaskRef('task-beta');
      expect(betaRecords.length).toBe(2);
      expect(betaRecords[1]?.error).toBe('Rate limit exceeded');

      sink.close();
    });
  });

  describe('CapBudgetGovernor (Rule 2 & STASIS tripwire)', () => {
    it('allows spend within cap and trips STASIS on breach', async () => {
      const governor = new CapBudgetGovernor({ capUsd: 1.0, spentUsd: 0, clock });

      // Check spend $0.50 -> allowed
      const verdict1 = governor.check({
        action: 'llm.query',
        estimate: { currency: 'usd', min: 0.1, max: 0.5 },
      });

      expect(verdict1.allowed).toBe(true);
      if (verdict1.allowed) {
        expect(verdict1.remaining_usd).toBe(0.5);
      }

      // Record actual spend $0.80
      governor.recordSpend(0.8);

      // Check spend $0.30 -> breaches remaining $0.20 cap -> trips STASIS
      const verdict2 = governor.check({
        action: 'llm.query',
        estimate: { currency: 'usd', min: 0.1, max: 0.3 },
      });

      expect(verdict2.allowed).toBe(false);
      if (!verdict2.allowed) {
        expect(verdict2.reason).toBe('BUDGET_BREACH');
        expect(verdict2.message).toContain('exceeds remaining cap');
      }

      // Subsequent checks are unconditionally blocked while in STASIS
      const verdict3 = governor.check({
        action: 'llm.ping',
        estimate: { currency: 'usd', min: 0.0, max: 0.0 },
      });

      expect(verdict3.allowed).toBe(false);
      expect(governor.state().stasis_active).toBe(true);

      // Human-only resume resets STASIS
      governor.resume('human');
      expect(governor.state().stasis_active).toBe(false);
      expect(governor.state().last_trip?.resumed_by).toBe('human');
      governor.close();
    });
  });

  describe('PromptApprovalGate', () => {
    it('approves under auto policy with valid signature', async () => {
      const gate = new PromptApprovalGate({ policy: 'auto', clock });
      const id = crypto.randomUUID();
      const intentId = crypto.randomUUID();

      const decision = await gate.request({
        id,
        ts: new Date(clock.now()).toISOString(),
        intent_id: intentId,
        scopes: ['repo.write'],
        nonce: crypto.randomUUID(),
        rationale: 'Update configuration file for tests',
        expires_at: new Date(clock.now() + 60000).toISOString(),
      });

      expect(decision.decision).toBe('approved');
      expect(decision.signature).toBeDefined();
      expect(decision.decided_by).toBe('human');
    });

    it('denies under deny policy', async () => {
      const gate = new PromptApprovalGate({ policy: 'deny', clock });
      const id = crypto.randomUUID();
      const intentId = crypto.randomUUID();

      const decision = await gate.request({
        id,
        ts: new Date(clock.now()).toISOString(),
        intent_id: intentId,
        scopes: ['flags.write'],
        nonce: crypto.randomUUID(),
        rationale: 'Purge feature flag overrides',
        expires_at: new Date(clock.now() + 60000).toISOString(),
      });

      expect(decision.decision).toBe('denied');
      expect(decision.decided_by).toBe('human');
    });
  });
});
