/**
 * GEV v2 governance ports — "the Tadpole seam" (PLAN.md §6).
 *
 * These are STABLE COMMITMENTS. Local stubs live in packages/governance;
 * AI-TadPole-OS adapters implement these exact contracts at merge rungs
 * M1–M4. Changing a shape here requires an ADR and a PORTS_VERSION bump.
 *
 * Wire fields use snake_case where they cross language boundaries
 * (Tadpole's engine is Rust); TypeScript aliases provided below.
 */
import { z } from 'zod';

/** Wire-format version. Adapters negotiate on this value. */
export const PORTS_VERSION = '0.3.0';

/**
 * Canonical event names — shared vocabulary with AI-TadPole-OS.
 * These strings appear on the SSE audit stream and in stored WAL entries.
 * DO NOT rename casually; downstream consumers grep for them.
 */
export const GevEvents = {
  AuditIntent: 'audit.intent',
  AuditOutcome: 'audit.outcome',
  ApprovalRequested: 'approval.request',
  ApprovalResolved: 'approval.resolved',
  BudgetThresholdExceeded: 'budget.threshold.exceeded',
  StasisEntered: 'stasis.entered',
  StasisResumed: 'stasis.resumed', // human-only action, see RUNBOOK.md §STASIS
  CapabilityIssued: 'capability.issued',
} as const;

// ─── Actors ─────────────────────────────────────────────────────────────

export const Actor = z.enum(['ai', 'human', 'system']);
export type Actor = z.infer<typeof Actor>;

// ─── Port 1: AuditSink ──────────────────────────────────────────────────

const AuditBase = {
  id: z.string().uuid(),
  ts: z.string().datetime(),
  actor: Actor,
  /** Dot-namespaced action, e.g. 'ops.set_flag', 'fs.write', 'provider.fetch'. */
  action: z.string().min(3).max(128),
  target: z.string().max(512),
  params: z.unknown().optional(),
  /** Ties this action to a briefed unit of work (see AgentEnvelope.taskRef). */
  task_ref: z.string().min(1).max(256),
};

/** Logged BEFORE execution. No mutating action may run without one. */
export const AuditIntent = z.object({
  kind: z.literal(GevEvents.AuditIntent),
  ...AuditBase,
});
export type AuditIntent = z.infer<typeof AuditIntent>;

/** Logged AFTER execution. Must reference its intent. */
export const AuditOutcome = z
  .object({
    kind: z.literal(GevEvents.AuditOutcome),
    intent_id: z.string().uuid(),
    ts: z.string().datetime(),
    status: z.enum(['ok', 'error', 'blocked']),
    result: z.unknown().optional(),
    /** Required when status === 'blocked' (trip code or denial reason). */
    error: z.string().optional(),
    duration_ms: z.number().int().nonnegative().optional(),
  })
  .refine((o) => o.status !== 'blocked' || !!o.error, {
    message: 'blocked outcomes must state why',
  });
export type AuditOutcome = z.infer<typeof AuditOutcome>;

export const AuditEntrySchema = z.union([AuditIntent, AuditOutcome]);
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditQuery = z.object({
  actor: Actor.optional(),
  action_prefix: z.string().optional(),
  since: z.string().datetime().optional(),
  limit: z.number().int().positive().max(1000).default(100),
});
export type AuditQuery = z.infer<typeof AuditQuery>;

export interface AuditSink {
  /** MUST be called before executing the described action. */
  intent(i: AuditIntent): void;
  /** MUST be called after execution, whatever the result. */
  outcome(o: AuditOutcome): void;
  tail(q?: AuditQuery): AuditEntry[];
}

// ─── Port 2: ApprovalGate ───────────────────────────────────────────────

export const ApprovalScope = z.enum([
  'repo.write',
  'deploy.preview',
  'deploy.prod',
  'spend.external',
  'flags.write',
  'data.export',
]);
export type ApprovalScope = z.infer<typeof ApprovalScope>;

export const ApprovalRequest = z.object({
  id: z.string().uuid(),
  ts: z.string().datetime(),
  intent_id: z.string().uuid(),
  scopes: z
    .array(ApprovalScope)
    .min(1)
    .refine((scopes) => new Set(scopes).size === scopes.length, {
      message: 'approval request scopes must be unique',
    }),
  /** Verifier-issued, single-use challenge echoed by a signed M2 approval. */
  nonce: z.string().uuid(),
  rationale: z.string().min(8).max(2000),
  /** Gates must not linger unanswered. */
  expires_at: z.string().datetime(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;

const ApprovalSignerId = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9:_-]*$/, 'signer IDs must use lowercase ASCII identifiers');

const ApprovalKeyId = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'key IDs must use portable ASCII identifiers');

const CanonicalApprovalScopes = z
  .array(ApprovalScope)
  .min(1)
  .superRefine((scopes, context) => {
    if (new Set(scopes).size !== scopes.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'approval scopes must be unique' });
    }
    const sorted = [...scopes].sort();
    if (scopes.some((scope, index) => scope !== sorted[index])) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'signed approval scopes must be lexicographically sorted',
      });
    }
  });

/**
 * Versioned payload covered byte-for-byte by an Ed25519 M2 signature.
 * Serialization is RFC 8785 JSON Canonicalization Scheme (JCS).
 */
export const SignedApprovalPayloadSchema = z
  .object({
    format: z.literal('gev.m2.approval.v1'),
    request_id: z.string().uuid(),
    intent_id: z.string().uuid(),
    decision: z.literal('approved'),
    scopes: CanonicalApprovalScopes,
    signer_id: ApprovalSignerId,
    key_id: ApprovalKeyId,
    nonce: z.string().uuid(),
    issued_at: z.string().datetime(),
    decided_by: z.literal('human'),
    decided_at: z.string().datetime(),
    expires_at: z.string().datetime(),
  })
  .strict();
export type SignedApprovalPayload = z.infer<typeof SignedApprovalPayloadSchema>;

export const SignedApprovalEnvelopeSchema = z
  .object({
    algorithm: z.literal('Ed25519'),
    payload: SignedApprovalPayloadSchema,
    /** Unpadded RFC 4648 base64url-encoded 64-byte Ed25519 signature. */
    signature: z
      .string()
      .length(86)
      .regex(/^[A-Za-z0-9_-]+$/, 'signature must be unpadded base64url'),
  })
  .strict();
export type SignedApprovalEnvelope = z.infer<typeof SignedApprovalEnvelopeSchema>;

/** Untrusted response returned by an external/local approval decision provider. */
export const ApprovalProviderResponseSchema = z.discriminatedUnion('decision', [
  z
    .object({
      decision: z.literal('approved'),
      signed_approval: SignedApprovalEnvelopeSchema,
    })
    .strict(),
  z
    .object({
      request_id: z.string().uuid(),
      decision: z.enum(['denied', 'expired']),
      decided_by: Actor,
      decided_at: z.string().datetime(),
    })
    .strict(),
]);
export type ApprovalProviderResponse = z.infer<typeof ApprovalProviderResponseSchema>;

export const ApprovalResult = z
  .object({
    request_id: z.string().uuid(),
    decision: z.enum(['approved', 'denied', 'expired']),
    /** Opaque locally; Ed25519 signature from M2 onward. Required when approved. */
    signature: z.string().optional(),
    decided_by: Actor,
    decided_at: z.string().datetime(),
  })
  .refine((r) => r.decision !== 'approved' || !!r.signature, {
    message: 'approved results require a signature',
  });
export type ApprovalResult = z.infer<typeof ApprovalResult>;

export interface ApprovalGate {
  request(r: ApprovalRequest): Promise<ApprovalResult>;
}

// ─── Port 3: BudgetGovernor ─────────────────────────────────────────────

/** Typed error registry — remediation paths documented in RUNBOOK.md. */
export const TripCode = z.enum(['BUDGET_BREACH', 'LOGIC_BLOCKER', 'COMPLIANCE_DRIFT']);
export type TripCode = z.infer<typeof TripCode>;

export const CostEstimate = z
  .object({
    currency: z.literal('usd'), // widen deliberately, not accidentally
    min: z.number().finite().nonnegative(),
    max: z.number().finite().nonnegative(),
  })
  .refine((e) => e.min <= e.max, { message: 'min exceeds max' });
export type CostEstimate = z.infer<typeof CostEstimate>;

export const Verdict = z.discriminatedUnion('allowed', [
  z.object({ allowed: z.literal(true), remaining_usd: z.number().finite() }),
  z.object({ allowed: z.literal(false), reason: TripCode, message: z.string() }),
]);
export type Verdict = z.infer<typeof Verdict>;

export const BudgetState = z.object({
  stasis_active: z.boolean(),
  period_start: z.string().datetime(),
  spent_usd: z.number().finite().nonnegative(),
  cap_usd: z.number().finite().positive(),
  warn_threshold_pct: z.number().int().min(1).max(100),
  last_trip: z
    .object({ code: TripCode, at: z.string().datetime(), resumed_by: Actor.optional() })
    .nullable(),
});
export type BudgetState = z.infer<typeof BudgetState>;

export interface BudgetGovernor {
  /** Call before any spend-bearing action. */
  check(a: { action: string; estimate: CostEstimate }): Verdict;
  /** Records settled dollar spend against cap. */
  recordSpend?(amountUsd: number): void;
  /** Trips STASIS. Only humans may resume (RUNBOOK.md §STASIS). */
  trip(reason: TripCode, message: string): void;
  state(): BudgetState;
}

// ─── Port 4: CapabilityIssuer ───────────────────────────────────────────

export const CapabilityScope = z.enum([
  'read.telemetry',
  'read.audit',
  'write.flags',
  'write.scenes',
  'operate.cesium',
  'agent.voice',
]);
export type CapabilityScope = z.infer<typeof CapabilityScope>;

export const CapTokenClaims = z.object({
  /** Actor identity, e.g. 'ai:session-7', 'human:dev', 'svc:tadpole'. */
  sub: z.string().min(3),
  scopes: z.array(CapabilityScope).min(1),
  iat: z.string().datetime(),
  exp: z.string().datetime(),
});
export type CapTokenClaims = z.infer<typeof CapTokenClaims>;

export const CapToken = z.object({
  /** Opaque locally; becomes a signed capability token at M2+. */
  token: z.string(),
  claims: CapTokenClaims,
});
export type CapToken = z.infer<typeof CapToken>;

export interface CapabilityIssuer {
  issue(sub: string, scopes: CapabilityScope[], ttlSeconds: number): CapToken;
  /** Returns valid scopes, or null if expired/invalid. */
  verify(t: CapToken): CapabilityScope[] | null;
}

// ─── Port 5: AgentEnvelope (the 4-Pillar task brief, PLAN.md §7.6) ──────

export const TaskBrief = z.object({
  id: z.string(),
  title: z.string().min(4).max(160),
  scope_contract: z.object({
    in_scope: z.array(z.string()).min(1),
    out_of_scope: z.array(z.string()).default([]),
  }),
  /** Measurable done-criteria — each item must be objectively checkable. */
  performance_threshold: z.array(z.string()).min(1),
  /** Applicable laws from PLAN.md §2/§3; deviations require stated ADR. */
  architecture_mode: z.array(z.string()).default([]),
  /** Known traps for this specific task. */
  failure_modes: z.array(z.string()).default([]),
  task_ref: z.string(),
});
export type TaskBrief = z.infer<typeof TaskBrief>;

export interface AgentEnvelope {
  wrap(task: TaskBrief): { enveloped: string; taskRef: string };
}

// ─── Tool manifest flags (data-driven prod gating, PLAN.md §6) ──────────

export const ToolManifest = z.object({
  name: z.string(),
  description: z.string(),
  /** JSON Schema emitted from the tool's own Zod input schema. */
  input_schema: z.unknown(),
  is_mutating: z.boolean(),
  is_dangerous: z.boolean(),
  is_cacheable: z.boolean().default(false),
  required_scopes: z.array(CapabilityScope).default([]),
  approval_scopes: z.array(ApprovalScope).default([]),
});
export type ToolManifest = z.infer<typeof ToolManifest>;
