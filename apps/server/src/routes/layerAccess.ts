import crypto from 'node:crypto';
import {
  type Actor,
  GevEvents,
  type LayerAccessProviderRuntimeInput,
  LayerAccessReadModelSchema,
  type ProviderRegistry,
  ProviderRegistrySchema,
} from '@gev/contracts';
import type { SimClock } from '@gev/core';
import type {
  CapBudgetGovernor,
  SqliteAuditSink,
  SqliteBudgetLedger,
  SqliteTenantLayerAccessStore,
} from '@gev/governance';
import { createLayerAccessReadModel } from '@gev/providers';
import { Hono } from 'hono';
import { createLayerAccessAdminRouter } from './layerAccessAdmin.js';

const MAX_LAYER_ACCESS_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface LayerAccessRouterOptions {
  clock: SimClock;
  auditSink: SqliteAuditSink;
  budgetGovernor: CapBudgetGovernor;
  budgetLedger?: SqliteBudgetLedger;
  tenantLayerAccessStore?: SqliteTenantLayerAccessStore;
  getProviderRegistry(): ProviderRegistry;
  environment?: Readonly<Record<string, string | undefined>>;
  getAuthorizedLocalState?: () => readonly LayerAccessProviderRuntimeInput[];
  credentialValidator?: (
    providerId: string,
    secret: string
  ) => Promise<{ valid: boolean; error?: string }>;
}

function policyState(
  provider: ProviderRegistry['providers'][number],
  environment: Readonly<Record<string, string | undefined>>
) {
  const killSwitch = provider.source_access.operations.kill_switch;
  const isEnvironmentFlag = /^GEV_[A-Z0-9_]+$/.test(killSwitch);
  const enabled = !isEnvironmentFlag || environment[killSwitch] !== '0';
  return {
    enabled,
    reason: enabled ? null : `Disabled by ${killSwitch} platform policy`,
  };
}

function publicRuntimeState(
  registry: ProviderRegistry,
  environment: Readonly<Record<string, string | undefined>>
): LayerAccessProviderRuntimeInput[] {
  return registry.providers.map((provider) => ({
    provider_id: provider.id,
    policy: policyState(provider, environment),
    runtime: {
      status: provider.health,
      observation_at: null,
      retrieved_at: null,
      cache_origin_at: null,
      last_success_at: null,
      last_error_at: null,
      next_poll_at: null,
      detail:
        provider.health === 'healthy'
          ? null
          : provider.health === 'degraded'
            ? 'Provider health is degraded; source observation and retrieval age remain distinct'
            : `Provider runtime is unavailable in ${provider.mode} mode`,
    },
  }));
}

function taskRef(header: string | undefined): string {
  return header && /^[A-Za-z0-9._:-]{1,120}$/.test(header) ? header : 'layer-access-read';
}

/** Authenticated, audited, bounded read projection; this route never calls a provider. */
export function createLayerAccessRouter(options: LayerAccessRouterOptions): Hono {
  const router = new Hono();
  const environment = options.environment ?? process.env;

  router.get('/', (context) => {
    const identity = context.var as unknown as {
      opsActor: Actor;
      opsAuthenticated: boolean;
    };
    const startedAt = options.clock.now();
    const intentId = crypto.randomUUID();
    options.auditSink.intent({
      kind: GevEvents.AuditIntent,
      id: intentId,
      ts: new Date(startedAt).toISOString(),
      actor: identity.opsActor,
      action: 'layer_access.read',
      target: 'provider-registry',
      params: { redaction: 'masked-status-only', provider_network_access: false },
      task_ref: taskRef(context.req.header('X-Task-Ref')),
    });

    try {
      const registry = ProviderRegistrySchema.parse(options.getProviderRegistry());
      const authenticated = identity.opsAuthenticated === true && identity.opsActor === 'human';
      const tenantId =
        (identity as unknown as { opsTenantId?: string }).opsTenantId ?? 'tenant-local';
      const tenantInputs =
        authenticated && options.tenantLayerAccessStore
          ? options.tenantLayerAccessStore.getTenantRuntimeInputs(tenantId)
          : [];
      const authorizedLocalInputs =
        authenticated && options.getAuthorizedLocalState ? options.getAuthorizedLocalState() : [];
      const combinedInputs = [...authorizedLocalInputs, ...tenantInputs];
      const stateByProvider = new Map(combinedInputs.map((state) => [state.provider_id, state]));
      const providers = publicRuntimeState(registry, environment).map((state) => ({
        ...state,
        ...(stateByProvider.get(state.provider_id) ?? {}),
        provider_id: state.provider_id,
      }));

      const governorState = options.budgetGovernor.state();
      let tenantStasisActive = governorState.stasis_active;
      let budgetRemainingUsd = Math.max(0, governorState.cap_usd - governorState.spent_usd);
      if (options.budgetLedger && authenticated) {
        const tenantBudget = options.budgetLedger.getTenantBudget(tenantId);
        if (tenantBudget) {
          if (tenantBudget.stasis_active === 1) {
            tenantStasisActive = true;
          }
          const held = options.budgetLedger.getTenantHeldMicrousd(tenantId);
          budgetRemainingUsd = Math.max(
            0,
            (tenantBudget.cap_microusd - tenantBudget.spent_microusd - held) / 1_000_000
          );
        }
      }

      const hasAuthority =
        options.getAuthorizedLocalState !== undefined ||
        (options.tenantLayerAccessStore !== undefined && tenantInputs.length > 0);
      const unavailableReason = authenticated
        ? 'No approved local credential-status authority is configured for this server'
        : 'Authenticate as the local human operator to read masked local access status';
      const model = LayerAccessReadModelSchema.parse(
        createLayerAccessReadModel(registry, {
          version: 1,
          observed_at: new Date(options.clock.now()).toISOString(),
          stasis_active: tenantStasisActive,
          budget_remaining_usd: budgetRemainingUsd,
          authority: {
            kind: authenticated ? 'authenticated_local_operator' : 'local_seed',
            credential_status_access:
              authenticated && hasAuthority ? 'masked_status' : 'unavailable',
            reason: authenticated && hasAuthority ? null : unavailableReason,
          },
          providers,
        })
      );
      const serialized = JSON.stringify(model);
      if (Buffer.byteLength(serialized, 'utf8') > MAX_LAYER_ACCESS_RESPONSE_BYTES) {
        throw new Error('Layer Access projection exceeded its response-size boundary');
      }
      options.auditSink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: new Date(options.clock.now()).toISOString(),
        status: 'ok',
        result: {
          entry_count: model.entries.length,
          masked_status_authorized: model.authority.credential_status_access === 'masked_status',
        },
        duration_ms: options.clock.now() - startedAt,
      });
      context.header('Cache-Control', 'no-store');
      context.header('Vary', 'Authorization');
      return context.body(serialized, 200, { 'Content-Type': 'application/json; charset=UTF-8' });
    } catch {
      options.auditSink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: new Date(options.clock.now()).toISOString(),
        status: 'blocked',
        error: 'Layer Access read projection failed closed',
        duration_ms: options.clock.now() - startedAt,
      });
      return context.json(
        { code: 'LAYER_ACCESS_UNAVAILABLE', error: 'Layer Access status is unavailable' },
        503
      );
    }
  });

  router.route('/', createLayerAccessAdminRouter(options));

  return router;
}
