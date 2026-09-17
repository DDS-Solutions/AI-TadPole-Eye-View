import { randomUUID } from 'node:crypto';
import {
  type AuditSink,
  type BusinessContextPreview,
  type DetectedPromptThreat,
  GevEvents,
  PromptProtectionError,
  type PromptSanitizationResult,
  type SanitizedPromptContext,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import {
  type PromptSanitizerOptions,
  buildPromptContextFromBusinessPreview,
  sanitizeUntrustedText,
} from '@gev/economic';

export interface PrepareGovernedPromptContextOptions {
  contextId: string;
  tenantId: string;
  preview: BusinessContextPreview;
  userQuery?: string;
  systemInstructions?: string;
  auditSink?: AuditSink;
  clock?: SimClock;
  options?: PromptSanitizerOptions;
}

/**
 * MCP-layer prompt safety evaluator.
 * Verifies untrusted text safety and enforces the < 5ms p95 latency threshold.
 */
export function evaluatePromptSafety(
  text: string,
  options: PromptSanitizerOptions = {}
): PromptSanitizationResult {
  const result = sanitizeUntrustedText(text, options);
  if (result.execution_duration_ms > 5.0) {
    console.warn(
      `[PROMPT_SAFETY_WARN] Sanitization exceeded 5ms threshold: ${result.execution_duration_ms}ms`
    );
  }
  return result;
}

/**
 * Prepares a governed, sanitized prompt context from a BusinessContextPreview for downstream
 * AI/Tadpole consumption, logging security audit records (intent + outcome) when adversarial injections are neutralized or rejected.
 */
export async function prepareGovernedPromptContext(
  options: PrepareGovernedPromptContextOptions
): Promise<SanitizedPromptContext> {
  const {
    contextId,
    tenantId,
    preview,
    userQuery,
    systemInstructions,
    auditSink,
    clock = new SystemClock(),
    options: sanitizerOptions,
  } = options;

  let promptContext: SanitizedPromptContext;
  try {
    promptContext = buildPromptContextFromBusinessPreview({
      contextId,
      tenantId,
      preview,
      userQuery,
      systemInstructions,
      options: sanitizerOptions,
    });
  } catch (err) {
    if (err instanceof PromptProtectionError && err.code === 'INJECTION_DETECTED') {
      if (auditSink) {
        const threats = Array.isArray(err.details) ? (err.details as DetectedPromptThreat[]) : [];
        const categories = Array.from(new Set(threats.map((t) => t.category)));
        emitSecurityAudit({
          auditSink,
          action: 'security.prompt_injection_rejected',
          contextId,
          tenantId,
          threatCount: threats.length,
          categories,
          status: 'blocked',
          clock,
          error: err.message,
        });
      }
    }
    throw err;
  }

  // Collect all detected threats across data blocks
  const detectedThreats = promptContext.data_blocks.flatMap((b) => b.threats);

  if (detectedThreats.length > 0) {
    const categories = Array.from(new Set(detectedThreats.map((t) => t.category)));

    if (sanitizerOptions?.mode === 'reject') {
      if (auditSink) {
        emitSecurityAudit({
          auditSink,
          action: 'security.prompt_injection_rejected',
          contextId,
          tenantId,
          threatCount: detectedThreats.length,
          categories,
          status: 'blocked',
          clock,
          error: `Rejected ${detectedThreats.length} prompt injection threats`,
        });
      }
      throw new PromptProtectionError(
        'INJECTION_DETECTED',
        `Prompt context ${contextId} rejected due to ${detectedThreats.length} prompt injection threats: ${categories.join(', ')}`,
        detectedThreats
      );
    }

    if (auditSink) {
      emitSecurityAudit({
        auditSink,
        action: 'security.prompt_injection_neutralized',
        contextId,
        tenantId,
        threatCount: detectedThreats.length,
        categories,
        status: 'ok',
        clock,
      });
    }
  }

  return promptContext;
}

function emitSecurityAudit(params: {
  auditSink: AuditSink;
  action: string;
  contextId: string;
  tenantId: string;
  threatCount: number;
  categories: string[];
  status: 'ok' | 'blocked';
  clock: SimClock;
  error?: string;
}): void {
  const { auditSink, action, contextId, tenantId, threatCount, categories, status, clock, error } =
    params;
  const intentId = randomUUID();
  const ts = new Date(clock.now()).toISOString();

  auditSink.intent({
    kind: GevEvents.AuditIntent,
    id: intentId,
    ts,
    actor: 'system',
    action,
    target: `prompt_context:${contextId}`,
    task_ref: contextId,
    params: {
      tenantId,
      threatCount,
      categories,
    },
  });

  auditSink.outcome({
    kind: GevEvents.AuditOutcome,
    intent_id: intentId,
    ts: new Date(clock.now()).toISOString(),
    status,
    result: { threatCount, categories },
    error: status === 'blocked' ? (error ?? 'Prompt injection detected') : undefined,
  });
}
