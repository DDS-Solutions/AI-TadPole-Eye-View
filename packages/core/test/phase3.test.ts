import type { ApprovalGate, AuditEntry, AuditSink, BudgetGovernor } from '@gev/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import {
  CollabIntentDoc,
  FrozenClock,
  GovernedToolExecutor,
  MockAgentAdapter,
  createVoiceSessionMachine,
  voiceSessionMachine,
} from '../src/index.js';
import { TestBudgetLedger } from './budgetLedgerFixture.js';

function createAllowingBudgetGovernor(): BudgetGovernor {
  return {
    check: () => ({ allowed: true, remaining_usd: 10 }),
    trip: () => {},
    state: () => ({
      period_start: '2024-01-01T00:00:00.000Z',
      cap_usd: 10,
      spent_usd: 0,
      warn_threshold_pct: 80,
      stasis_active: false,
      last_trip: null,
    }),
  };
}

function createApprovingGate(): ApprovalGate {
  return {
    request: async (request) => ({
      request_id: request.id,
      decision: 'approved',
      signature: 'test-signature',
      decided_by: 'human',
      decided_at: request.ts,
    }),
  };
}

function createAuditSink(): AuditSink {
  return { intent: () => {}, outcome: () => {}, tail: () => [] };
}

describe('Phase 3 Core Framework (@gev/core)', () => {
  describe('GovernedToolExecutor', () => {
    it('executes tool, validates schemas, and logs AuditIntent and AuditOutcome', async () => {
      const entries: AuditEntry[] = [];

      const mockAuditSink: AuditSink = {
        intent: () => {},
        outcome: () => {},
        tail: () => [],
      };

      const clock = new FrozenClock(1_725_000_000_000);
      const executor = new GovernedToolExecutor({
        auditSink: mockAuditSink,
        approvalGate: createApprovingGate(),
        budgetGovernor: createAllowingBudgetGovernor(),
        budgetLedger: new TestBudgetLedger({ entries }),
        clock,
      });

      executor.register('fly_to_location', (input) => {
        return {
          moved: true,
          target: {
            lat: input.lat,
            lon: input.lon,
            altitude_m: input.altitude_m ?? 500000,
          },
        };
      });

      const res = await executor.execute('fly_to_location', {
        lat: 48.8566,
        lon: 2.3522,
        altitude_m: 30000,
      });

      expect(res.success).toBe(true);
      expect(res.result).toEqual({
        moved: true,
        target: { lat: 48.8566, lon: 2.3522, altitude_m: 30000 },
      });

      // Verify Pre-execution AuditIntent
      expect(entries[0]).toEqual(
        expect.objectContaining({
          action: 'tool.fly_to_location',
          params: expect.objectContaining({ lat: 48.8566, lon: 2.3522 }),
          ts: clock.iso(),
        })
      );

      // Verify Post-execution AuditOutcome
      expect(entries[1]).toEqual(
        expect.objectContaining({
          status: 'ok',
          result: expect.objectContaining({ moved: true }),
          ts: clock.iso(),
          duration_ms: 0,
        })
      );
    });

    it('blocks execution when STASIS is active in BudgetGovernor', async () => {
      const mockGovernor: BudgetGovernor = {
        check: () => ({ allowed: false, reason: 'BUDGET_BREACH', message: 'Hard cap exceeded' }),
        trip: () => {},
        state: () => ({
          period_start: new Date().toISOString(),
          cap_usd: 10,
          spent_usd: 10.5,
          warn_threshold_pct: 80,
          stasis_active: true,
          last_trip: { code: 'BUDGET_BREACH', at: new Date().toISOString() },
        }),
      };

      const executor = new GovernedToolExecutor({
        auditSink: createAuditSink(),
        approvalGate: createApprovingGate(),
        budgetGovernor: mockGovernor,
        budgetLedger: new TestBudgetLedger({ deny: true }),
      });
      executor.register('toggle_layer', (input) => ({ ...input, updated: true }));
      const res = await executor.execute('toggle_layer', { layer: 'flights', enabled: true });

      expect(res.success).toBe(false);
      expect(res.blocked).toBe(true);
      expect(res.code).toBe('BUDGET_DENIED');
      expect(res.error).toContain('STASIS active');
    });

    it('queries ApprovalGate for dangerous tools', async () => {
      const approvalSpy = vi.fn().mockResolvedValue({
        request_id: '11111111-2222-3333-4444-555555555555',
        decision: 'denied',
        decided_by: 'human',
        decided_at: new Date().toISOString(),
      });

      const mockApprovalGate: ApprovalGate = {
        request: approvalSpy,
      };

      const executor = new GovernedToolExecutor({
        auditSink: createAuditSink(),
        approvalGate: mockApprovalGate,
        budgetGovernor: createAllowingBudgetGovernor(),
        budgetLedger: new TestBudgetLedger(),
      });
      executor.register('load_scene', () => {
        throw new Error('handler must not execute after approval denial');
      });
      const res = await executor.execute('load_scene', { scene_json: '{"version":1}' });

      expect(approvalSpy).toHaveBeenCalledTimes(1);
      expect(res.success).toBe(false);
      expect(res.blocked).toBe(true);
      expect(res.error).toContain('rejected by ApprovalGate');
    });
  });

  describe('Voice Session State Machine (XState v5)', () => {
    it('handles full lifecycle: idle -> connecting -> listening -> processing -> speaking', () => {
      const actor = createActor(voiceSessionMachine);
      actor.start();

      expect(actor.getSnapshot().value).toBe('idle');

      actor.send({ type: 'CONNECT', provider: 'mock' });
      expect(actor.getSnapshot().value).toBe('connecting');

      actor.send({ type: 'CONNECTED', sessionId: 'sess_123' });
      expect(actor.getSnapshot().value).toEqual({ connected: 'listening' });
      expect(actor.getSnapshot().context.sessionId).toBe('sess_123');

      actor.send({ type: 'USER_TEXT', text: 'Fly to Singapore' });
      expect(actor.getSnapshot().value).toEqual({ connected: 'processing' });
      expect(actor.getSnapshot().context.transcript.length).toBe(1);

      actor.send({ type: 'AGENT_AUDIO_CHUNK', size: 1024 });
      expect(actor.getSnapshot().value).toEqual({ connected: 'speaking' });

      actor.send({ type: 'AGENT_AUDIO_COMPLETE' });
      expect(actor.getSnapshot().value).toEqual({ connected: 'listening' });
    });

    it('executes immediate barge-in interruption on VAD_SPEECH_START while speaking', () => {
      const actor = createActor(voiceSessionMachine);
      actor.start();

      actor.send({ type: 'CONNECT' });
      actor.send({ type: 'CONNECTED', sessionId: 'sess_barge' });
      actor.send({ type: 'USER_TEXT', text: 'Hello' });
      actor.send({ type: 'AGENT_AUDIO_CHUNK', size: 512 });

      expect(actor.getSnapshot().value).toEqual({ connected: 'speaking' });

      // Barge-in occurs while agent is speaking
      actor.send({ type: 'VAD_SPEECH_START' });

      // Immediately back to listening
      expect(actor.getSnapshot().value).toEqual({ connected: 'listening' });
      expect(actor.getSnapshot().context.lastBargeInTs).not.toBeNull();
    });

    it('uses the injected clock for transcript IDs, timestamps, and barge-in state', () => {
      const clock = new FrozenClock(1_700_000_000_123);
      const actor = createActor(createVoiceSessionMachine(clock));
      actor.start();
      actor.send({ type: 'CONNECT' });
      actor.send({ type: 'CONNECTED', sessionId: 'sess_clock' });
      actor.send({ type: 'USER_TEXT', text: 'Clock test' });

      expect(actor.getSnapshot().context.transcript[0]).toMatchObject({
        id: 'user_1700000000123_1',
        ts: 1_700_000_000_123,
      });

      actor.send({ type: 'VAD_SPEECH_START' });
      expect(actor.getSnapshot().context.lastBargeInTs).toBe(1_700_000_000_123);
    });

    it('halts and freezes on STASIS_TRIPPED and resumes cleanly', () => {
      const actor = createActor(voiceSessionMachine);
      actor.start();

      actor.send({ type: 'CONNECT' });
      actor.send({ type: 'CONNECTED', sessionId: 'sess_stasis' });

      actor.send({ type: 'STASIS_TRIPPED', reason: 'Spend cap breached $10.00' });
      expect(actor.getSnapshot().value).toBe('stasis_halted');
      expect(actor.getSnapshot().context.stasisReason).toContain('Spend cap breached');

      // Resume
      actor.send({ type: 'STASIS_RESUMED' });
      expect(actor.getSnapshot().value).toBe('idle');
      expect(actor.getSnapshot().context.stasisReason).toBeNull();
    });
  });

  describe('Agent Provider Adapters', () => {
    it('MockAgentAdapter dispatches deterministic tool calls based on user query', async () => {
      const adapter = new MockAgentAdapter({ deterministicSeed: 40 });
      const toolCallSpy = vi.fn();
      const textDeltaSpy = vi.fn();

      adapter.setEvents({
        onToolCall: toolCallSpy,
        onTextDelta: textDeltaSpy,
      });

      await adapter.connect();
      expect(adapter.status).toBe('connected');

      await adapter.sendText('Please fly to Tokyo right now');

      expect(textDeltaSpy).toHaveBeenCalledWith(expect.stringContaining('Tokyo'));
      expect(toolCallSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'fly_to_location',
          callId: 'mock_call_41',
          arguments: expect.objectContaining({ lat: 35.6762, lon: 139.6503 }),
        })
      );
    });
  });

  describe('CollabIntentDoc (Yjs CRDT Intent Sync)', () => {
    it('synchronizes intent state across two doc replicas bit-for-bit', () => {
      const docA = new CollabIntentDoc('room-alpha');
      const docB = new CollabIntentDoc('room-alpha');

      // Wire two-way update replication
      docA.onUpdate((update) => docB.applyUpdate(update));
      docB.onUpdate((update) => docA.applyUpdate(update));

      // User A selects an aircraft and enables layers
      docA.setSelectedEntity({ layer: 'flights', id: 'AFR1234' });
      docA.setLayerState('flights', true);
      docA.setLayerState('marine', false);
      docA.addAoi({
        id: 'aoi-1',
        name: 'South China Sea AOI',
        bounds: [5, 105, 20, 120],
        createdBy: 'Operator-A',
        createdAtTs: 1700000000,
      });

      // User B receives intent state via CRDT
      expect(docB.getSelectedEntity()).toEqual({ layer: 'flights', id: 'AFR1234' });
      expect(docB.getActiveLayers()).toEqual({ flights: true, marine: false });
      expect(docB.getAois()).toHaveLength(1);
      expect(docB.getAois()[0].name).toBe('South China Sea AOI');

      // User B modifies sim time offset
      docB.setSimTimeOffset(-300);
      expect(docA.getSimTimeOffset()).toBe(-300);

      // JSON serializes properly
      const json = docA.toJSON();
      expect(json.roomId).toBe('room-alpha');
      expect(json.selectedEntity?.id).toBe('AFR1234');
    });
  });
});
