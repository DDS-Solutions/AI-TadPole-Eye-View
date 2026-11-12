import { TaskBrief } from '@gev/contracts';
import type { McpAuthorizationContext } from '@gev/contracts/mcp-authorization';
import { FrozenClock } from '@gev/core';
import { describe, expect, it } from 'vitest';
import { TadpoleAgentEnvelope, TadpoleCapabilityIssuer } from '../src/agentEnvelope.js';
import { SqliteAuditSink } from '../src/auditSink.js';
import { CapBudgetGovernor } from '../src/budgetGovernor.js';
import { TadpoleConnectionLifecycle } from '../src/tadpoleSessionLifecycle.js';

const BASE_EPOCH = 1_731_400_000_000;

function makeAuth(): McpAuthorizationContext {
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
  };
}

describe('Tadpole AgentEnvelope & Capability Propagation Performance (Task 12.1)', () => {
  it('meets performance threshold: envelope wrapping and capability propagation < 2ms p95', () => {
    const clock = new FrozenClock(BASE_EPOCH);
    const auditSink = new SqliteAuditSink({ clock, dbPath: ':memory:' });
    const budgetGovernor = new CapBudgetGovernor({ clock, dbPath: ':memory:', capUsd: 5.0 });
    const issuer = new TadpoleCapabilityIssuer({ clock });
    const envelope = new TadpoleAgentEnvelope(clock);
    const lifecycle = new TadpoleConnectionLifecycle({
      clock,
      auditSink,
      budgetGovernor,
      capabilityIssuer: issuer,
      agentEnvelope: envelope,
    });

    const brief = TaskBrief.parse({
      id: '12.1',
      title: 'Benchmark Brief',
      scope_contract: { in_scope: ['packages/governance'] },
      performance_threshold: ['p95 < 2ms'],
      task_ref: 'task-12-1-brief',
    });
    const capToken = issuer.issue('svc:tadpole-agent', ['read.telemetry'], 600);
    const session = lifecycle.openSession({
      transport: 'http-2026-07-28',
      authorization: makeAuth(),
      capToken,
      taskBrief: brief,
    });

    for (let w = 0; w < 20; w++) {
      envelope.wrap(brief);
      lifecycle.propagateCapabilities(session.session_id, capToken, ['read.telemetry']);
    }

    const latencies: number[] = [];
    for (let i = 0; i < 200; i++) {
      const start = performance.now();
      envelope.wrap(brief);
      lifecycle.propagateCapabilities(session.session_id, capToken, ['read.telemetry']);
      latencies.push(performance.now() - start);
    }
    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
    console.log(
      `[BENCHMARK] Task 12.1 Envelope + Capability Propagation (N=200): p95=${p95.toFixed(3)}ms`
    );
    expect(p95).toBeLessThan(2);

    budgetGovernor.close();
    auditSink.close();
  });
});
