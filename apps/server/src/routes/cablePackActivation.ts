import crypto from 'node:crypto';
import {
  type Actor,
  CablePackActivationRequestSchema,
  CablePackActivationResponseSchema,
  type SetFlagOutput,
} from '@gev/contracts';
import type { GovernedToolExecutor, ToolExecutionResult } from '@gev/core';
import type { CableAdapter } from '@gev/providers';
import { Hono } from 'hono';

export interface CablePackActivationRouterOptions {
  executor: Pick<GovernedToolExecutor, 'execute'>;
  adapter: CableAdapter;
  readActivationError(packId: string): string | undefined;
}

function statusForResult(result: ToolExecutionResult): 403 | 409 | 422 | 503 {
  if (result.code === 'APPROVAL_DENIED' || result.code === 'BUDGET_DENIED') return 403;
  if (
    result.code === 'IDEMPOTENCY_CONFLICT' ||
    result.code === 'OPERATION_IN_PROGRESS' ||
    result.code === 'OPERATION_IN_DOUBT'
  ) {
    return 409;
  }
  if (
    result.code === 'LEDGER_UNAVAILABLE' ||
    result.code === 'GOVERNANCE_UNAVAILABLE' ||
    result.code === 'APPROVAL_UNAVAILABLE'
  ) {
    return 503;
  }
  return 422;
}

/** Local human surface for the shared governed set-flag execution path. */
export function createCablePackActivationRouter(options: CablePackActivationRouterOptions): Hono {
  const router = new Hono();

  router.post('/packs/activate', async (context) => {
    const identity = context.var as unknown as {
      opsActor: Actor;
      opsAuthenticated: boolean;
    };
    if (identity.opsAuthenticated !== true || identity.opsActor !== 'human') {
      return context.json(
        {
          error: 'Cable pack activation requires an authenticated human',
          code: 'HUMAN_AUTH_REQUIRED',
        },
        403
      );
    }

    const parsed = CablePackActivationRequestSchema.safeParse(
      await context.req.json().catch(() => null)
    );
    if (!parsed.success) {
      return context.json(
        { error: 'Invalid cable pack activation request', code: 'INVALID_INPUT' },
        400
      );
    }

    const operationId = context.req.header('Idempotency-Key') ?? crypto.randomUUID();
    const taskRef = context.req.header('X-Task-Ref') ?? `cable-pack:${parsed.data.pack_id}`;
    context.header('X-GEV-Operation-Id', operationId);
    const flag = `cables.download-pack.${parsed.data.pack_id}`;
    const result = await options.executor.execute<SetFlagOutput>(
      'set_flag',
      { flag, enabled: true },
      { actor: 'human', operation_id: operationId, task_ref: taskRef }
    );

    if (!result.success) {
      return context.json(
        {
          activated: false,
          operation_id: operationId,
          code: result.code ?? 'ACTIVATION_FAILED',
          error: result.error ?? 'Cable pack activation failed closed',
        },
        statusForResult(result)
      );
    }
    if (!result.result?.updated || options.adapter.getActivePackId() !== parsed.data.pack_id) {
      return context.json(
        {
          activated: false,
          operation_id: operationId,
          code: 'PACK_VALIDATION_FAILED',
          error:
            options.readActivationError(parsed.data.pack_id) ??
            'Cable pack did not pass validation and was not activated',
        },
        422
      );
    }

    const catalog = await options.adapter.getCatalog();
    return context.json(
      CablePackActivationResponseSchema.parse({
        activated: true,
        pack_id: parsed.data.pack_id,
        operation_id: operationId,
        mode: catalog.provenance.mode,
        route_count: catalog.routes.length,
        landing_point_count: catalog.landing_points.length,
        provenance: catalog.provenance,
      })
    );
  });

  return router;
}
