import { randomUUID } from 'node:crypto';
import { type BusinessContextPreview, GevEvents, PromptProtectionError } from '@gev/contracts';
import type { ToolExecutionContext } from '@gev/core';
import type { OperatorContext } from './context.js';
import { evaluatePromptSafety, prepareGovernedPromptContext } from './promptSafety.js';

/** Resolves authoritative tenant identity for economic MCP handlers. */
export function resolveEconomicTenantId(executionContext: ToolExecutionContext = {}): string {
  return (
    executionContext.tenant_id ??
    (executionContext.identity ? executionContext.identity.tenant_id : 'tenant-local')
  );
}

/**
 * Enforces global STASIS, per-tenant STASIS, and the economic kill-switch
 * uniformly across all economic MCP tool handlers.
 */
export function assertEconomicToolAllowed(
  ctx: OperatorContext,
  executionContext: ToolExecutionContext,
  toolLabel: string
): string {
  if (ctx.budgetGovernor.state().stasis_active) {
    throw new Error(`STASIS: ${toolLabel} is suspended while global STASIS is active`);
  }
  const tenantId = resolveEconomicTenantId(executionContext);
  const tenantBudget = ctx.budgetLedger.getTenantBudget(tenantId);
  if (tenantBudget.stasis_active === 1) {
    throw new Error(`STASIS: ${toolLabel} is suspended for tenant '${tenantId}'`);
  }
  if (ctx.flags.get('economic.enabled') === false) {
    throw new Error('Economic analysis engine is disabled by kill-switch policy');
  }
  return tenantId;
}

/**
 * Neutralizes potential prompt-injection text inside untrusted caller/provider fields
 * and emits an audit trail entry when threats are detected.
 */
export function sanitizeEconomicText(
  text: string,
  fieldLabel: string,
  tenantId: string,
  ctx?: Pick<OperatorContext, 'auditSink' | 'clock'>
): string {
  const result = evaluatePromptSafety(text, { mode: 'neutralize' });
  if (result.threats_detected.length > 0 && ctx) {
    const intentId = randomUUID();
    const categories = Array.from(new Set(result.threats_detected.map((t) => t.category)));
    ctx.auditSink.intent({
      kind: GevEvents.AuditIntent,
      id: intentId,
      ts: new Date(ctx.clock.now()).toISOString(),
      actor: 'system',
      action: 'security.prompt_injection_neutralized',
      target: `tenant:${tenantId}:${fieldLabel}`,
      task_ref: `prompt-safety-${fieldLabel}`,
      params: {
        tenantId,
        threatCount: result.threats_detected.length,
        categories,
      },
    });
    ctx.auditSink.outcome({
      kind: GevEvents.AuditOutcome,
      intent_id: intentId,
      ts: new Date(ctx.clock.now()).toISOString(),
      status: 'ok',
      result: { threatCount: result.threats_detected.length, categories },
    });
  }
  return result.sanitized_text;
}

/**
 * Validates and neutralizes untrusted fields on a synthesized BusinessContextPreview
 * through the governed prompt-protection pipeline prior to MCP/LLM exposure.
 */
export async function hardenBusinessPreviewWithPromptGuard(
  ctx: Pick<OperatorContext, 'auditSink' | 'clock'>,
  tenantId: string,
  preview: BusinessContextPreview,
  options?: { rejectOnThreat?: boolean }
): Promise<BusinessContextPreview> {
  const promptContext = await prepareGovernedPromptContext({
    contextId: preview.preview_id,
    tenantId,
    preview,
    auditSink: ctx.auditSink,
    clock: ctx.clock,
    options: { mode: options?.rejectOnThreat ? 'reject' : 'neutralize' },
  });

  const allThreats = promptContext.data_blocks.flatMap((b) => b.threats);
  const warnings = [...preview.warnings];
  if (allThreats.length > 0) {
    const categories = Array.from(new Set(allThreats.map((t) => t.category)));
    warnings.push(
      `Prompt safety neutralized ${allThreats.length} suspicious pattern(s): ${categories.join(', ')}`
    );
  }

  return {
    ...preview,
    input: {
      ...preview.input,
      business_name: sanitizeEconomicText(preview.input.business_name, 'business_name', tenantId),
      industry_title: sanitizeEconomicText(
        preview.input.industry_title,
        'industry_title',
        tenantId
      ),
      target_geography: {
        ...preview.input.target_geography,
        ...(preview.input.target_geography.name
          ? {
              name: sanitizeEconomicText(
                preview.input.target_geography.name,
                'geography_name',
                tenantId
              ),
            }
          : {}),
      },
    },
    warnings,
  };
}

export { PromptProtectionError };
