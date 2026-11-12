import { z } from 'zod';
import { TenantIdSchema } from './identity.js';
import { CapToken, CapabilityScope } from './ports.js';

// ============================================================================
// Tadpole AgentEnvelope, Connection Lifecycle & Capability Propagation Contracts
// (PLAN.md §10 Task 12.1 & ADR 0038)
// ============================================================================

export const TADPOLE_ENVELOPE_SCHEMA_VERSION = 1 as const;

export const TadpoleConnectionStateSchema = z.enum([
  'disconnected',
  'connecting',
  'authenticated',
  'active',
  'draining',
  'suspended_stasis',
  'closed',
]);
export type TadpoleConnectionState = z.infer<typeof TadpoleConnectionStateSchema>;

export const TadpoleTransportModeSchema = z.enum(['http-2026-07-28', 'stdio-2024-11-05']);
export type TadpoleTransportMode = z.infer<typeof TadpoleTransportModeSchema>;

export const TadpoleWrappedBriefSchema = z
  .object({
    schema_version: z.literal(TADPOLE_ENVELOPE_SCHEMA_VERSION),
    task_id: z.string().min(1).max(128),
    task_ref: z.string().min(1).max(256),
    title: z.string().min(4).max(160),
    enveloped: z.string().min(1),
    brief_sha256: z.string().regex(/^[0-9a-f]{64}$/, 'brief_sha256 must be a 64-char hex digest'),
    issued_at: z.string().datetime(),
  })
  .strict();
export type TadpoleWrappedBrief = z.infer<typeof TadpoleWrappedBriefSchema>;

export const TadpoleAgentSessionSchema = z
  .object({
    session_id: z.string().uuid(),
    transport: TadpoleTransportModeSchema,
    protocol_version: z.enum(['2026-07-28', '2024-11-05']),
    state: TadpoleConnectionStateSchema,
    principal: z.string().min(3).max(128),
    tenant_id: TenantIdSchema,
    task_ref: z.string().min(1).max(256),
    brief_sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    granted_scopes: z
      .array(CapabilityScope)
      .min(1)
      .refine((scopes) => new Set(scopes).size === scopes.length, {
        message: 'granted_scopes must be unique',
      }),
    connected_at: z.string().datetime(),
    last_heartbeat_at: z.string().datetime(),
    expires_at: z.string().datetime(),
    stasis_reason: z.string().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((session, ctx) => {
    if (session.transport === 'http-2026-07-28' && session.protocol_version !== '2026-07-28') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['protocol_version'],
        message: 'http-2026-07-28 transport must negotiate protocol_version 2026-07-28',
      });
    }
    if (session.transport === 'stdio-2024-11-05' && session.protocol_version !== '2024-11-05') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['protocol_version'],
        message: 'stdio-2024-11-05 transport must negotiate protocol_version 2024-11-05',
      });
    }
    if (session.state === 'suspended_stasis' && !session.stasis_reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stasis_reason'],
        message: 'suspended_stasis session state requires a non-empty stasis_reason',
      });
    }
  });
export type TadpoleAgentSession = z.infer<typeof TadpoleAgentSessionSchema>;

export const TadpoleCapabilityPropagationSchema = z
  .object({
    cap_token: CapToken,
    envelope_task_ref: z.string().min(1).max(256),
    tenant_id: TenantIdSchema,
    principal: z.string().min(3).max(128),
    propagated_scopes: z
      .array(CapabilityScope)
      .min(1)
      .refine((scopes) => new Set(scopes).size === scopes.length, {
        message: 'propagated_scopes must be unique',
      }),
  })
  .strict()
  .superRefine((prop, ctx) => {
    if (prop.cap_token.claims.sub !== prop.principal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['principal'],
        message: 'Capability token subject must match propagated principal',
      });
    }
    const granted = new Set(prop.cap_token.claims.scopes);
    for (const scope of prop.propagated_scopes) {
      if (!granted.has(scope)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['propagated_scopes'],
          message: `Cannot propagate scope '${scope}' not granted in capability token`,
        });
      }
    }
  });
export type TadpoleCapabilityPropagation = z.infer<typeof TadpoleCapabilityPropagationSchema>;
