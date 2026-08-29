import {
  type Actor,
  type ApprovalGate,
  type ApprovalRequest,
  ApprovalRequest as ApprovalRequestSchema,
  type ApprovalResult,
  ApprovalResult as ApprovalResultSchema,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';

export type ApprovalPromptHandler = (request: ApprovalRequest) => Promise<boolean> | boolean;

export interface PromptApprovalGateOptions {
  policy?: 'auto' | 'deny' | 'prompt';
  clock?: SimClock;
  decidedBy?: Actor;
  promptHandler?: ApprovalPromptHandler;
}

/**
 * Prompt Approval Gate (PLAN.md §6 & §10 Item 7)
 * Implements the ApprovalGate port contract with policy-based switching and prompt delegation.
 */
export class PromptApprovalGate implements ApprovalGate {
  private readonly policy: 'auto' | 'deny' | 'prompt';
  private readonly clock: SimClock;
  private readonly decidedBy: Actor;
  private readonly promptHandler?: ApprovalPromptHandler;

  constructor(options: PromptApprovalGateOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.decidedBy = options.decidedBy ?? 'human';
    this.promptHandler = options.promptHandler;

    const envPolicy = process.env.GEV_APPROVAL_POLICY;
    const isSeedOrTest =
      process.env.GEV_SEED_MODE === '1' ||
      process.env.NODE_ENV === 'test' ||
      process.env.VITEST === 'true';
    const requestedPolicy =
      options.policy ??
      (envPolicy === 'auto' || envPolicy === 'deny' || envPolicy === 'prompt'
        ? envPolicy
        : isSeedOrTest
          ? 'auto'
          : 'deny');
    if (process.env.NODE_ENV === 'production' && requestedPolicy !== 'deny') {
      throw new Error('Prompt/auto approval policies are forbidden in production');
    }
    if (requestedPolicy !== 'deny' && !isSeedOrTest) {
      throw new Error('Prompt/auto approval policies require explicit seed or test mode');
    }
    this.policy = requestedPolicy;
  }

  /**
   * Evaluates approval for a mutating action request.
   */
  async request(requestInput: ApprovalRequest): Promise<ApprovalResult> {
    const r = ApprovalRequestSchema.parse(requestInput);
    const decidedAt = new Date(this.clock.now()).toISOString();

    if (this.policy === 'deny') {
      return ApprovalResultSchema.parse({
        request_id: r.id,
        decision: 'denied',
        decided_by: this.decidedBy,
        decided_at: decidedAt,
      });
    }

    if (this.policy === 'prompt') {
      if (this.promptHandler) {
        const approved = await this.promptHandler(r);
        return ApprovalResultSchema.parse({
          request_id: r.id,
          decision: approved ? 'approved' : 'denied',
          signature: approved ? `sig-prompt-${r.id.slice(0, 8)}` : undefined,
          decided_by: this.decidedBy,
          decided_at: decidedAt,
        });
      }

      // Fail closed if prompt policy requested but no interactive prompt channel configured
      return ApprovalResultSchema.parse({
        request_id: r.id,
        decision: 'denied',
        decided_by: this.decidedBy,
        decided_at: decidedAt,
      });
    }

    // Explicit 'auto' policy in dev/test seed mode
    return ApprovalResultSchema.parse({
      request_id: r.id,
      decision: 'approved',
      signature: `sig-stub-${r.id.slice(0, 8)}`,
      decided_by: this.decidedBy,
      decided_at: decidedAt,
    });
  }
}

/** Production-safe default when no verified M2 provider is configured. */
export class UnavailableApprovalGate implements ApprovalGate {
  private readonly clock: SimClock;

  constructor(clock: SimClock = new SystemClock()) {
    this.clock = clock;
  }

  async request(requestInput: ApprovalRequest): Promise<ApprovalResult> {
    const request = ApprovalRequestSchema.parse(requestInput);
    return ApprovalResultSchema.parse({
      request_id: request.id,
      decision: 'denied',
      decided_by: 'system',
      decided_at: new Date(this.clock.now()).toISOString(),
    });
  }
}
