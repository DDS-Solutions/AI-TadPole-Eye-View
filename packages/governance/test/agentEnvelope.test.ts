import { TaskBrief } from '@gev/contracts';
import type { McpAuthorizationContext } from '@gev/contracts/mcp-authorization';
import { FrozenClock } from '@gev/core';
import { describe, expect, it } from 'vitest';
import { TadpoleAgentEnvelope, TadpoleCapabilityIssuer } from '../src/agentEnvelope.js';
import {
  TadpoleConnectionLifecycle,
  TadpoleLifecycleError,
} from '../src/tadpoleSessionLifecycle.js';
import { SqliteAuditSink } from '../src/auditSink.js';
import { CapBudgetGovernor } from '../src/budgetGovernor.js';

const BASE_EPOCH = 1_731_400_000_000;

function makeAuth(overrides: Partial<McpAuthorizationContext> = {}): McpAuthorizationContext {
  const nowSec = Math.floor(BASE_EPOCH / 1000);
  return {
    actor: 'ai',
    role: 'ai_copilot',
    principal: 'svc:tadpole-agent',
    tenant_id: 'tenant-alpha',
    client_id: 'tadpole-runtime',
    token_id: 'jwt-1234',
    issuer: 'https://auth.gev.test/',
    audience: 'http://127.0.0.1:3000/mcp',
    resource: 'http://127.0.0.1:3000/mcp',
    scopes: ['read.telemetry', 'read.audit'],
    issued_at_epoch_seconds: nowSec - 10,
    not_before_epoch_seconds: nowSec - 10,
    expires_at_epoch_seconds: nowSec + 240,
    task_ref: 'task-12-1-brief',
    ...overrides,
  };
}

describe('Tadpole AgentEnvelope, CapabilityIssuer & Connection Lifecycle (Task 12.1 & ADR 0038)', () => {
  it('wraps 4-Pillar TaskBrief deterministically and rejects control characters', () => {
    const clock = new FrozenClock(BASE_EPOCH);
    const envelope = new TadpoleAgentEnvelope(clock);

    const brief = TaskBrief.parse({
      id: '12.1',
      title: 'Tadpole AgentEnvelope Mapping',
      scope_contract: {
        in_scope: ['packages/governance'],
        out_of_scope: ['apps/web'],
      },
      performance_threshold: ['p95 < 2ms'],
      architecture_mode: ['PLAN.md §12.1'],
      failure_modes: ['Never bypass governance'],
      task_ref: 'task-12-1-brief',
    });

    const wrapped = envelope.wrapDetailed(brief);
    expect(wrapped.task_ref).toBe('task-12-1-brief');
    expect(wrapped.enveloped).toContain('[SCOPE_CONTRACT]');
    expect(wrapped.enveloped).toContain('[PERFORMANCE_THRESHOLD]');
    expect(wrapped.enveloped).toContain('[ARCHITECTURE_MODE]');
    expect(wrapped.enveloped).toContain('[FAILURE_MODES]');
    expect(wrapped.brief_sha256).toMatch(/^[0-9a-f]{64}$/);

    expect(() =>
      envelope.wrap({
        ...brief,
        task_ref: 'bad\u0000ref',
      })
    ).toThrow(/control characters/);
  });

  it('issues, verifies, expires, and revokes Ed25519 CapTokens cleanly', () => {
    const clock = new FrozenClock(BASE_EPOCH);
    const auditSink = new SqliteAuditSink({ clock, dbPath: ':memory:' });
    const issuer = new TadpoleCapabilityIssuer({ clock, auditSink });

    const capToken = issuer.issue('svc:tadpole-agent', ['read.telemetry'], 60);
    expect(issuer.verify(capToken)).toEqual(['read.telemetry']);
    expect(issuer.verify(capToken.token)).toEqual(['read.telemetry']);

    // Tampered token rejected
    expect(issuer.verify(`${capToken.token}tamper`)).toBeNull();

    // Advance clock past expiry
    clock.setTime(BASE_EPOCH + 61_000);
    expect(issuer.verify(capToken)).toBeNull();

    // Revoked token rejected immediately
    const activeToken = issuer.issue('svc:tadpole-agent', ['read.telemetry'], 60);
    expect(issuer.verify(activeToken)).toEqual(['read.telemetry']);
    issuer.revoke(activeToken);
    expect(issuer.verify(activeToken)).toBeNull();

    auditSink.close();
  });

  it('manages connection lifecycle, least-privilege intersection, STASIS suspension, and audit trail', () => {
    const clock = new FrozenClock(BASE_EPOCH);
    const auditSink = new SqliteAuditSink({ clock, dbPath: ':memory:' });
    const budgetGovernor = new CapBudgetGovernor({ clock, dbPath: ':memory:', capUsd: 5.0 });
    const issuer = new TadpoleCapabilityIssuer({ clock, auditSink });
    const envelope = new TadpoleAgentEnvelope(clock);
    const lifecycle = new TadpoleConnectionLifecycle({
      clock,
      auditSink,
      budgetGovernor,
      capabilityIssuer: issuer,
      agentEnvelope: envelope,
    });

    const auth = makeAuth({ scopes: ['read.telemetry', 'read.audit'] });
    const capToken = issuer.issue('svc:tadpole-agent', ['read.telemetry'], 300);

    const session = lifecycle.openSession({
      transport: 'http-2026-07-28',
      authorization: auth,
      capToken,
    });
    expect(session.state).toBe('active');
    expect(session.granted_scopes).toEqual(['read.telemetry']); // Intersection, never escalated

    // Propagate permitted scope succeeds
    const propagated = lifecycle.propagateCapabilities(session.session_id, capToken, [
      'read.telemetry',
    ]);
    expect(propagated.effectiveScopes).toEqual(['read.telemetry']);

    // Propagate non-granted scope fails closed
    expect(() =>
      lifecycle.propagateCapabilities(session.session_id, capToken, ['read.audit'])
    ).toThrow(TadpoleLifecycleError);

    // Heartbeat updates timestamp
    clock.setTime(BASE_EPOCH + 10_000);
    const hb = lifecycle.heartbeat(session.session_id);
    expect(hb.last_heartbeat_at).toBe(new Date(BASE_EPOCH + 10_000).toISOString());

    // STASIS suspends active sessions fail-closed
    budgetGovernor.trip('BUDGET_BREACH', 'Test STASIS trip');
    expect(() =>
      lifecycle.propagateCapabilities(session.session_id, capToken, ['read.telemetry'])
    ).toThrow(/STASIS/);
    expect(lifecycle.getSession(session.session_id)?.state).toBe('suspended_stasis');

    // Close & verify audit records
    const closed = lifecycle.drainAndClose(session.session_id, 'test_cleanup');
    expect(closed.state).toBe('closed');
    const logs = auditSink.tail({ limit: 20 });
    expect(logs.some((e) => e.kind === 'audit.intent' && e.action === 'tadpole.session.open')).toBe(
      true
    );
    expect(
      logs.some((e) => e.kind === 'audit.intent' && e.action === 'tadpole.session.close')
    ).toBe(true);

    budgetGovernor.close();
    auditSink.close();
  });
});
