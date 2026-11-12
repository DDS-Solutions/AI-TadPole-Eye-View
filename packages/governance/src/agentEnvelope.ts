import crypto from 'node:crypto';
import {
  type AgentEnvelope,
  type AuditSink,
  type CapToken,
  type CapTokenClaims,
  type CapabilityIssuer,
  type CapabilityScope,
  GevEvents,
  type TadpoleWrappedBrief,
  TadpoleWrappedBriefSchema,
  type TaskBrief,
  TaskBrief as TaskBriefSchema,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import { type TadpoleKeyPair, generateEd25519KeyPair } from './signedApproval.js';
import { issueSignedCapToken, verifySignedCapTokenWithClaims } from './tadpoleBridge.js';

// ============================================================================
// Port 4: TadpoleCapabilityIssuer (PLAN.md §6, §12.1 & ADR 0038)
// ============================================================================

export interface TadpoleCapabilityIssuerOptions {
  clock?: SimClock;
  keyPair?: TadpoleKeyPair;
  auditSink?: AuditSink;
}

export class TadpoleCapabilityIssuer implements CapabilityIssuer {
  private readonly clock: SimClock;
  private readonly keyPair: TadpoleKeyPair;
  private readonly publicKey: crypto.KeyObject;
  private readonly auditSink?: AuditSink;
  private readonly revokedTokens = new Set<string>();

  constructor(options: TadpoleCapabilityIssuerOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.keyPair = options.keyPair ?? generateEd25519KeyPair();
    this.publicKey = crypto.createPublicKey(this.keyPair.publicKeyPem);
    this.auditSink = options.auditSink;
  }

  getPublicKeyPem(): string {
    return this.keyPair.publicKeyPem;
  }

  issue(sub: string, scopes: CapabilityScope[], ttlSeconds: number): CapToken {
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 86_400) {
      throw new Error('Capability token TTL must be between 1 and 86,400 seconds');
    }

    const intentId = crypto.randomUUID();
    if (this.auditSink) {
      this.auditSink.intent({
        kind: GevEvents.AuditIntent,
        id: intentId,
        ts: this.clock.iso(),
        actor: 'system',
        action: 'capability.issue',
        target: sub,
        params: { scopes, ttl_seconds: ttlSeconds },
        task_ref: 'tadpole-capability-issuer',
      });
    }

    const token = issueSignedCapToken(
      sub,
      scopes,
      ttlSeconds,
      this.keyPair.privateKeyPem,
      this.clock
    );

    if (this.auditSink) {
      this.auditSink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: this.clock.iso(),
        status: 'ok',
        result: { sub: token.claims.sub, scopes: token.claims.scopes, exp: token.claims.exp },
      });
    }

    return token;
  }

  revoke(capToken: CapToken | string): void {
    const raw = typeof capToken === 'string' ? capToken : capToken.token;
    const digest = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
    this.revokedTokens.add(digest);
  }

  verify(capToken: CapToken | string): CapabilityScope[] | null {
    const claims = this.verifyWithClaims(capToken);
    return claims ? claims.scopes : null;
  }

  verifyWithClaims(capToken: CapToken | string): CapTokenClaims | null {
    const raw = typeof capToken === 'string' ? capToken : capToken.token;
    const digest = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
    if (this.revokedTokens.has(digest)) {
      return null;
    }

    return verifySignedCapTokenWithClaims(raw, this.publicKey, this.clock);
  }
}

// ============================================================================
// Port 5: TadpoleAgentEnvelope (PLAN.md §7.6, §12.1 & ADR 0038)
// ============================================================================

function assertNoControlCharacters(value: string, fieldName: string): void {
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if ((code < 32 && code !== 10 && code !== 13 && code !== 9) || code === 127) {
      throw new Error(`AgentEnvelope field '${fieldName}' contains prohibited control characters`);
    }
  }
}

export class TadpoleAgentEnvelope implements AgentEnvelope {
  private readonly clock: SimClock;

  constructor(clock: SimClock = new SystemClock()) {
    this.clock = clock;
  }

  wrap(task: TaskBrief): { enveloped: string; taskRef: string } {
    const detailed = this.wrapDetailed(task);
    return {
      enveloped: detailed.enveloped,
      taskRef: detailed.task_ref,
    };
  }

  wrapDetailed(rawTask: TaskBrief): TadpoleWrappedBrief {
    const task = TaskBriefSchema.parse(rawTask);
    assertNoControlCharacters(task.id, 'id');
    assertNoControlCharacters(task.title, 'title');
    assertNoControlCharacters(task.task_ref, 'task_ref');

    const inScope = task.scope_contract.in_scope.join('; ');
    const outScope =
      task.scope_contract.out_of_scope.length > 0
        ? ` Out of scope: ${task.scope_contract.out_of_scope.join('; ')}.`
        : '';
    const perf = task.performance_threshold.join('; ');
    const arch = task.architecture_mode.join('; ');
    const fails = task.failure_modes.join('; ');

    const enveloped = [
      `# TASK ${task.id}: ${task.title}`,
      `[TASK_REF] ${task.task_ref}`,
      `[SCOPE_CONTRACT] ${inScope}.${outScope}`,
      `[PERFORMANCE_THRESHOLD] ${perf}`,
      `[ARCHITECTURE_MODE] ${arch || 'PLAN.md §2/§3 default'}`,
      `[FAILURE_MODES] ${fails || 'Fail closed on ambiguity or governance trip'}`,
    ].join('\n');

    const briefSha256 = crypto.createHash('sha256').update(enveloped, 'utf8').digest('hex');

    return TadpoleWrappedBriefSchema.parse({
      schema_version: 1,
      task_id: task.id,
      task_ref: task.task_ref,
      title: task.title,
      enveloped,
      brief_sha256: briefSha256,
      issued_at: this.clock.iso(),
    });
  }
}
