import crypto from 'node:crypto';
import {
  type AuditSink,
  type BudgetGovernor,
  type CapToken,
  type CapabilityScope,
  GevEvents,
  type TadpoleAgentSession,
  TadpoleAgentSessionSchema,
  type TadpoleCapabilityPropagation,
  TadpoleCapabilityPropagationSchema,
  type TadpoleTransportMode,
  type TaskBrief,
} from '@gev/contracts';
import {
  type McpAuthorizationContext,
  McpAuthorizationContextSchema,
} from '@gev/contracts/mcp-authorization';
import type { SimClock } from '@gev/core';
import { TadpoleAgentEnvelope, type TadpoleCapabilityIssuer } from './agentEnvelope.js';

export interface TadpoleConnectionLifecycleOptions {
  clock: SimClock;
  auditSink: AuditSink;
  budgetGovernor: BudgetGovernor;
  capabilityIssuer: TadpoleCapabilityIssuer;
  agentEnvelope?: TadpoleAgentEnvelope;
  maxSessionTtlSeconds?: number;
}

export interface OpenTadpoleSessionInput {
  sessionId?: string;
  transport: TadpoleTransportMode;
  authorization: McpAuthorizationContext;
  capToken: CapToken | string;
  taskBrief?: TaskBrief;
  ttlSeconds?: number;
}

export interface PropagatedTadpoleContext {
  session: TadpoleAgentSession;
  propagation: TadpoleCapabilityPropagation;
  effectiveScopes: readonly CapabilityScope[];
}

export class TadpoleLifecycleError extends Error {
  constructor(
    readonly code:
      | 'STASIS_ACTIVE'
      | 'UNAUTHENTICATED'
      | 'INVALID_CAPABILITY_TOKEN'
      | 'SUBJECT_MISMATCH'
      | 'INSUFFICIENT_SCOPE'
      | 'SESSION_NOT_FOUND'
      | 'SESSION_INVALID_STATE'
      | 'SESSION_EXPIRED',
    message: string
  ) {
    super(message);
    this.name = 'TadpoleLifecycleError';
  }
}

export class TadpoleConnectionLifecycle {
  private readonly clock: SimClock;
  private readonly auditSink: AuditSink;
  private readonly budgetGovernor: BudgetGovernor;
  private readonly capabilityIssuer: TadpoleCapabilityIssuer;
  private readonly agentEnvelope: TadpoleAgentEnvelope;
  private readonly maxSessionTtlSeconds: number;
  private readonly sessions = new Map<string, TadpoleAgentSession>();

  constructor(options: TadpoleConnectionLifecycleOptions) {
    this.clock = options.clock;
    this.auditSink = options.auditSink;
    this.budgetGovernor = options.budgetGovernor;
    this.capabilityIssuer = options.capabilityIssuer;
    this.agentEnvelope = options.agentEnvelope ?? new TadpoleAgentEnvelope(options.clock);
    this.maxSessionTtlSeconds = options.maxSessionTtlSeconds ?? 3600;
  }

  openSession(input: OpenTadpoleSessionInput): TadpoleAgentSession {
    if (this.budgetGovernor.state().stasis_active) {
      throw new TadpoleLifecycleError(
        'STASIS_ACTIVE',
        'Cannot open Tadpole session while STASIS is active'
      );
    }

    const authParsed = McpAuthorizationContextSchema.safeParse(input.authorization);
    if (!authParsed.success) {
      throw new TadpoleLifecycleError('UNAUTHENTICATED', 'Invalid MCP authorization context');
    }
    const auth = authParsed.data;

    const claims = this.capabilityIssuer.verifyWithClaims(input.capToken);
    if (!claims) {
      throw new TadpoleLifecycleError(
        'INVALID_CAPABILITY_TOKEN',
        'Capability token is invalid, revoked, or expired'
      );
    }
    if (claims.sub !== auth.principal) {
      throw new TadpoleLifecycleError(
        'SUBJECT_MISMATCH',
        `Capability token subject '${claims.sub}' does not match principal '${auth.principal}'`
      );
    }

    // Least-privilege intersection: effective scopes cannot exceed authorization OR capability token
    const tokenScopeSet = new Set(claims.scopes);
    const effectiveScopes = auth.scopes.filter((s) => tokenScopeSet.has(s));
    if (effectiveScopes.length === 0) {
      throw new TadpoleLifecycleError(
        'INSUFFICIENT_SCOPE',
        'No overlapping scopes between authorization context and capability token'
      );
    }

    const wrappedBrief = input.taskBrief ? this.agentEnvelope.wrapDetailed(input.taskBrief) : null;
    if (wrappedBrief && wrappedBrief.task_ref !== auth.task_ref) {
      throw new TadpoleLifecycleError(
        'SUBJECT_MISMATCH',
        `TaskBrief task_ref '${wrappedBrief.task_ref}' does not match authority task_ref '${auth.task_ref}'`
      );
    }

    const sessionId = input.sessionId ?? crypto.randomUUID();
    const ttl = Math.min(input.ttlSeconds ?? 900, this.maxSessionTtlSeconds);
    const nowMs = this.clock.now();
    const nowIso = new Date(nowMs).toISOString();
    const tokenExpMs = Date.parse(claims.exp);
    const sessionExpMs = Math.min(nowMs + ttl * 1000, tokenExpMs);

    if (sessionExpMs <= nowMs) {
      throw new TadpoleLifecycleError('SESSION_EXPIRED', 'Capability token has already expired');
    }

    const intentId = crypto.randomUUID();
    this.auditSink.intent({
      kind: GevEvents.AuditIntent,
      id: intentId,
      ts: nowIso,
      actor: 'ai',
      action: 'tadpole.session.open',
      target: `session:${sessionId}`,
      params: {
        principal: auth.principal,
        tenant_id: auth.tenant_id,
        transport: input.transport,
        scopes: effectiveScopes,
      },
      task_ref: auth.task_ref,
    });

    const protocolVersion = input.transport === 'http-2026-07-28' ? '2026-07-28' : '2024-11-05';
    const session = TadpoleAgentSessionSchema.parse({
      session_id: sessionId,
      transport: input.transport,
      protocol_version: protocolVersion,
      state: 'active',
      principal: auth.principal,
      tenant_id: auth.tenant_id,
      task_ref: auth.task_ref,
      ...(wrappedBrief ? { brief_sha256: wrappedBrief.brief_sha256 } : {}),
      granted_scopes: effectiveScopes,
      connected_at: nowIso,
      last_heartbeat_at: nowIso,
      expires_at: new Date(sessionExpMs).toISOString(),
    });

    this.sessions.set(sessionId, session);

    this.auditSink.outcome({
      kind: GevEvents.AuditOutcome,
      intent_id: intentId,
      ts: nowIso,
      status: 'ok',
      result: { session_id: sessionId, state: session.state, scopes: effectiveScopes },
    });

    return session;
  }

  heartbeat(sessionId: string): TadpoleAgentSession {
    const existing = this.requireActiveSession(sessionId);
    const updated = TadpoleAgentSessionSchema.parse({
      ...existing,
      last_heartbeat_at: this.clock.iso(),
    });
    this.sessions.set(sessionId, updated);
    return updated;
  }

  enterStasis(reason: string): number {
    let transitioned = 0;
    for (const [id, session] of this.sessions.entries()) {
      if (session.state === 'active' || session.state === 'authenticated') {
        this.sessions.set(
          id,
          TadpoleAgentSessionSchema.parse({
            ...session,
            state: 'suspended_stasis',
            stasis_reason: reason,
          })
        );
        transitioned += 1;
      }
    }
    return transitioned;
  }

  drainAndClose(sessionId: string, reason = 'normal_shutdown'): TadpoleAgentSession {
    const existing = this.sessions.get(sessionId);
    if (!existing) {
      throw new TadpoleLifecycleError(
        'SESSION_NOT_FOUND',
        `Unknown Tadpole session '${sessionId}'`
      );
    }

    const intentId = crypto.randomUUID();
    const nowIso = this.clock.iso();
    this.auditSink.intent({
      kind: GevEvents.AuditIntent,
      id: intentId,
      ts: nowIso,
      actor: 'system',
      action: 'tadpole.session.close',
      target: `session:${sessionId}`,
      params: { previous_state: existing.state, reason },
      task_ref: existing.task_ref,
    });

    const closed = TadpoleAgentSessionSchema.parse({
      ...existing,
      state: 'closed',
    });
    this.sessions.set(sessionId, closed);

    this.auditSink.outcome({
      kind: GevEvents.AuditOutcome,
      intent_id: intentId,
      ts: nowIso,
      status: 'ok',
      result: { session_id: sessionId, state: 'closed' },
    });

    return closed;
  }

  propagateCapabilities(
    sessionId: string,
    capToken: CapToken | string,
    requiredScopes: readonly CapabilityScope[]
  ): PropagatedTadpoleContext {
    const session = this.requireActiveSession(sessionId);
    const claims = this.capabilityIssuer.verifyWithClaims(capToken);
    if (!claims) {
      throw new TadpoleLifecycleError(
        'INVALID_CAPABILITY_TOKEN',
        'Capability token is invalid, revoked, or expired'
      );
    }
    if (claims.sub !== session.principal) {
      throw new TadpoleLifecycleError(
        'SUBJECT_MISMATCH',
        'Capability token subject does not match active Tadpole session'
      );
    }

    const sessionScopes = new Set(session.granted_scopes);
    const tokenScopes = new Set(claims.scopes);
    const effectiveScopes = session.granted_scopes.filter(
      (s) => sessionScopes.has(s) && tokenScopes.has(s)
    );
    const effectiveSet = new Set(effectiveScopes);
    const missing = requiredScopes.filter((s) => !effectiveSet.has(s));
    if (missing.length > 0) {
      throw new TadpoleLifecycleError(
        'INSUFFICIENT_SCOPE',
        `Tadpole session lacks required capability scope(s): ${missing.join(', ')}`
      );
    }

    const rawToken = typeof capToken === 'string' ? capToken : capToken.token;
    const propagation = TadpoleCapabilityPropagationSchema.parse({
      cap_token: { token: rawToken, claims },
      envelope_task_ref: session.task_ref,
      tenant_id: session.tenant_id,
      principal: session.principal,
      propagated_scopes: effectiveScopes,
    });

    return {
      session,
      propagation,
      effectiveScopes: Object.freeze([...effectiveScopes]),
    };
  }

  getSession(sessionId: string): TadpoleAgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  listActiveSessions(): TadpoleAgentSession[] {
    return [...this.sessions.values()].filter((s) => s.state === 'active');
  }

  private requireActiveSession(sessionId: string): TadpoleAgentSession {
    if (this.budgetGovernor.state().stasis_active) {
      this.enterStasis('BudgetGovernor STASIS active');
      throw new TadpoleLifecycleError('STASIS_ACTIVE', 'Tadpole session suspended under STASIS');
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new TadpoleLifecycleError(
        'SESSION_NOT_FOUND',
        `Unknown Tadpole session '${sessionId}'`
      );
    }
    if (session.state !== 'active') {
      throw new TadpoleLifecycleError(
        'SESSION_INVALID_STATE',
        `Tadpole session '${sessionId}' is in state '${session.state}', expected 'active'`
      );
    }
    if (this.clock.now() >= Date.parse(session.expires_at)) {
      const closed = TadpoleAgentSessionSchema.parse({ ...session, state: 'closed' });
      this.sessions.set(sessionId, closed);
      throw new TadpoleLifecycleError(
        'SESSION_EXPIRED',
        `Tadpole session '${sessionId}' has expired`
      );
    }
    return session;
  }
}
