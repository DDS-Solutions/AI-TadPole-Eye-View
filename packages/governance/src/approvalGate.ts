import {
  type Actor,
  type ApprovalGate,
  type ApprovalRequest,
  ApprovalRequest as ApprovalRequestSchema,
  type ApprovalResult,
  ApprovalResult as ApprovalResultSchema,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';

export interface PromptApprovalGateOptions {
  policy?: 'auto' | 'deny' | 'prompt';
  clock?: SimClock;
  decidedBy?: Actor;
}

/**
 * Prompt Approval Gate Stub (PLAN.md §6 & §10 Item 7)
 * Implements the ApprovalGate port contract with policy-based test switching.
 */
export class PromptApprovalGate implements ApprovalGate {
  private readonly policy: 'auto' | 'deny' | 'prompt';
  private readonly clock: SimClock;
  private readonly decidedBy: Actor;

  constructor(options: PromptApprovalGateOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.decidedBy = options.decidedBy ?? 'human';

    const envPolicy = process.env.GEV_APPROVAL_POLICY;
    if (envPolicy === 'auto' || envPolicy === 'deny' || envPolicy === 'prompt') {
      this.policy = options.policy ?? envPolicy;
    } else {
      this.policy = options.policy ?? 'auto';
    }
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

    // Auto-approve in dev/test stub mode (with local stub signature)
    // TODO(M2): 'prompt' policy should integrate with Tadpole's interactive
    // approval channel. Until then, both 'auto' and 'prompt' auto-approve.
    if (this.policy === 'prompt') {
      console.error(
        `[governance:warn] ApprovalGate policy is 'prompt' but interactive prompting is not yet implemented (stub). Auto-approving request ${r.id}.`
      );
    }
    return ApprovalResultSchema.parse({
      request_id: r.id,
      decision: 'approved',
      signature: `sig-stub-${r.id.slice(0, 8)}`,
      decided_by: this.decidedBy,
      decided_at: decidedAt,
    });
  }
}
