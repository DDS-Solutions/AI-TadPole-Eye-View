import { describe, expect, it } from 'vitest';
import {
  TADPOLE_ENVELOPE_SCHEMA_VERSION,
  TadpoleAgentSessionSchema,
  TadpoleCapabilityPropagationSchema,
  TadpoleWrappedBriefSchema,
} from '../src/index.js';

describe('Tadpole AgentEnvelope & Session Contracts (PLAN.md §10 Task 12.1 & ADR 0038)', () => {
  const validSessionId = '11111111-1111-4111-8111-111111111111';
  const digest = 'a'.repeat(64);

  it('validates TadpoleWrappedBriefSchema and transport/protocol alignment', () => {
    expect(TADPOLE_ENVELOPE_SCHEMA_VERSION).toBe(1);

    const wrapped = TadpoleWrappedBriefSchema.parse({
      schema_version: 1,
      task_id: '12.1',
      task_ref: 'task-12-1',
      title: 'Finalize AgentEnvelope mapping',
      enveloped: '[SCOPE_CONTRACT] packages/governance',
      brief_sha256: digest,
      issued_at: '2026-11-12T12:00:00.000Z',
    });
    expect(wrapped.brief_sha256).toBe(digest);

    const session = TadpoleAgentSessionSchema.parse({
      session_id: validSessionId,
      transport: 'http-2026-07-28',
      protocol_version: '2026-07-28',
      state: 'active',
      principal: 'svc:tadpole-agent',
      tenant_id: 'tenant-alpha',
      task_ref: 'task-12-1',
      brief_sha256: digest,
      granted_scopes: ['read.telemetry'],
      connected_at: '2026-11-12T12:00:00.000Z',
      last_heartbeat_at: '2026-11-12T12:01:00.000Z',
      expires_at: '2026-11-12T12:15:00.000Z',
    });
    expect(session.state).toBe('active');

    // Mismatched transport & protocol_version rejected
    expect(() =>
      TadpoleAgentSessionSchema.parse({
        ...session,
        protocol_version: '2024-11-05',
      })
    ).toThrow(/protocol_version 2026-07-28/);

    // suspended_stasis requires stasis_reason
    expect(() =>
      TadpoleAgentSessionSchema.parse({
        ...session,
        state: 'suspended_stasis',
      })
    ).toThrow(/stasis_reason/);
  });

  it('prevents scope escalation and subject mismatch in TadpoleCapabilityPropagationSchema', () => {
    const capToken = {
      token: 'cap-ed25519.claims.sig',
      claims: {
        sub: 'svc:tadpole-agent',
        scopes: ['read.telemetry' as const],
        iat: '2026-11-12T12:00:00.000Z',
        exp: '2026-11-12T12:10:00.000Z',
      },
    };

    expect(
      TadpoleCapabilityPropagationSchema.parse({
        cap_token: capToken,
        envelope_task_ref: 'task-12-1',
        tenant_id: 'tenant-alpha',
        principal: 'svc:tadpole-agent',
        propagated_scopes: ['read.telemetry'],
      }).propagated_scopes
    ).toEqual(['read.telemetry']);

    // Escalated scope rejected
    expect(() =>
      TadpoleCapabilityPropagationSchema.parse({
        cap_token: capToken,
        envelope_task_ref: 'task-12-1',
        tenant_id: 'tenant-alpha',
        principal: 'svc:tadpole-agent',
        propagated_scopes: ['read.telemetry', 'write.flags'],
      })
    ).toThrow(/Cannot propagate scope 'write.flags'/);

    // Subject mismatch rejected
    expect(() =>
      TadpoleCapabilityPropagationSchema.parse({
        cap_token: capToken,
        envelope_task_ref: 'task-12-1',
        tenant_id: 'tenant-alpha',
        principal: 'svc:other-agent',
        propagated_scopes: ['read.telemetry'],
      })
    ).toThrow(/subject must match/);
  });
});
