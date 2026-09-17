import { z } from 'zod';
import { ECONOMIC_LEGAL_DISCLAIMER } from './economic.js';
import { TenantIdSchema } from './identity.js';
import { DataProvenanceSchema } from './provenance.js';

export const PROMPT_PROTECTION_SCHEMA_VERSION = 1 as const;

// ============================================================================
// Threat Categories & Detection
// ============================================================================

export const PromptThreatCategorySchema = z.enum([
  'system_override',
  'role_hijack',
  'delimiter_collision',
  'jailbreak_pattern',
  'exfiltration_attempt',
  'unicode_smuggling',
]);
export type PromptThreatCategory = z.infer<typeof PromptThreatCategorySchema>;

export const PromptThreatActionSchema = z.enum(['neutralized', 'escaped', 'stripped', 'rejected']);
export type PromptThreatAction = z.infer<typeof PromptThreatActionSchema>;

export const DetectedPromptThreatSchema = z
  .object({
    category: PromptThreatCategorySchema,
    matched_pattern: z.string().min(1).max(256),
    action_taken: PromptThreatActionSchema,
    offset: z.number().int().nonnegative().optional(),
    description: z.string().min(1).max(500).optional(),
  })
  .strict();
export type DetectedPromptThreat = z.infer<typeof DetectedPromptThreatSchema>;

// ============================================================================
// Sanitization Results & Status
// ============================================================================

export const PromptSanitizationStatusSchema = z.enum([
  'clean',
  'sanitized',
  'neutralized',
  'rejected',
]);
export type PromptSanitizationStatus = z.infer<typeof PromptSanitizationStatusSchema>;

export const PromptSanitizationResultSchema = z
  .object({
    is_safe: z.boolean(),
    original_length: z.number().int().nonnegative(),
    sanitized_text: z.string(),
    threats_detected: z.array(DetectedPromptThreatSchema),
    execution_duration_ms: z.number().nonnegative(),
  })
  .strict();
export type PromptSanitizationResult = z.infer<typeof PromptSanitizationResultSchema>;

// ============================================================================
// Sandboxed Data Block (Strict Data Separation & Mandatory Provenance)
// ============================================================================

export const SandboxedDataBlockSchema = z
  .object({
    block_id: z.string().min(1).max(128),
    source_id: z.string().min(1).max(128),
    label: z.string().min(1).max(256).optional(),
    content: z.string(),
    provenance: DataProvenanceSchema, // MANDATORY: missing provenance fails closed
    sanitization_status: PromptSanitizationStatusSchema,
    threats: z.array(DetectedPromptThreatSchema),
    nonce: z.string().min(8).max(64),
  })
  .strict();
export type SandboxedDataBlock = z.infer<typeof SandboxedDataBlockSchema>;

// ============================================================================
// Sanitized Prompt Context (Complete Envelope for LLM / Tadpole)
// ============================================================================

export const SanitizedPromptContextSchema = z
  .object({
    schema_version: z.literal(PROMPT_PROTECTION_SCHEMA_VERSION),
    context_id: z.string().min(1).max(128),
    tenant_id: TenantIdSchema,
    system_instructions: z.string().min(1),
    data_blocks: z.array(SandboxedDataBlockSchema).min(1).max(500),
    user_query: z.string().max(4000).optional(),
    rendered_prompt: z.string().min(1),
    generated_at: z.string().datetime({ offset: true }),
    disclaimer: z.literal(ECONOMIC_LEGAL_DISCLAIMER),
  })
  .strict();
export type SanitizedPromptContext = z.infer<typeof SanitizedPromptContextSchema>;

// ============================================================================
// Error Codes & Typed Domain Error
// ============================================================================

export const PromptProtectionErrorCodeSchema = z.enum([
  'MISSING_PROVENANCE',
  'INVALID_PROVENANCE',
  'UNSEPARATED_CONTENT',
  'INJECTION_DETECTED',
  'DELIMITER_COLLISION',
  'PAYLOAD_TOO_LARGE',
  'INVALID_CONTEXT',
]);
export type PromptProtectionErrorCode = z.infer<typeof PromptProtectionErrorCodeSchema>;

export class PromptProtectionError extends Error {
  readonly code: PromptProtectionErrorCode;
  readonly details?: unknown;

  constructor(code: PromptProtectionErrorCode, message: string, details?: unknown) {
    super(`[${code}] ${message}`);
    this.name = 'PromptProtectionError';
    this.code = code;
    this.details = details;
  }
}
