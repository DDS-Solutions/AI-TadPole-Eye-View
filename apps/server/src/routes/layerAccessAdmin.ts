import crypto from 'node:crypto';
import {
  type Actor,
  GevEvents,
  type IdentityRole,
  ProviderRegistryIdSchema,
  TenantLayerCredentialRevocationSchema,
  TenantLayerCredentialSubmissionSchema,
  TenantLayerCredentialValidationRequestSchema,
  TenantLayerTermsAcceptanceSchema,
  TenantLayerTermsRevocationSchema,
} from '@gev/contracts';
import type { SimClock } from '@gev/core';
import type { SqliteAuditSink, SqliteTenantLayerAccessStore } from '@gev/governance';
import { type Context, Hono } from 'hono';

export interface LayerAccessAdminRouterOptions {
  clock: SimClock;
  auditSink: SqliteAuditSink;
  tenantLayerAccessStore?: SqliteTenantLayerAccessStore;
  credentialValidator?: (
    providerId: string,
    secret: string
  ) => Promise<{ valid: boolean; error?: string }>;
}

interface AdminIdentity {
  tenantId: string;
  principal: string;
}

function taskRef(header: string | undefined): string {
  return header && /^[A-Za-z0-9._:-]{1,120}$/.test(header) ? header : 'layer-access-admin';
}

function checkAdminAuthorization(c: Context):
  | {
      authorized: true;
      admin: AdminIdentity;
    }
  | {
      authorized: false;
      response: Response;
    } {
  const opsAuthenticated = c.get('opsAuthenticated') as boolean | undefined;
  const opsActor = c.get('opsActor') as Actor | undefined;
  const opsRole = c.get('opsRole') as IdentityRole | undefined;
  const opsTenantId = c.get('opsTenantId') as string | undefined;
  const opsPrincipal = c.get('opsPrincipal') as string | undefined;

  // H1: Fail closed if identity context is incomplete
  if (!opsAuthenticated || !opsTenantId || !opsPrincipal) {
    return {
      authorized: false,
      response: c.json({ code: 'UNAUTHORIZED', error: 'Authentication required' }, 401),
    };
  }

  // Human only — AI identities cannot perform mutating layer access administration
  if (opsActor !== 'human') {
    return {
      authorized: false,
      response: c.json(
        {
          code: 'ROLE_ACCESS_DENIED',
          error: 'Only human tenant administrators may administer layer credentials',
        },
        403
      ),
    };
  }

  // Role must be tenant_admin or platform_admin
  if (opsRole !== 'tenant_admin' && opsRole !== 'platform_admin') {
    return {
      authorized: false,
      response: c.json(
        { code: 'ROLE_ACCESS_DENIED', error: 'Requires tenant_admin or platform_admin role' },
        403
      ),
    };
  }

  // Cross-tenant credential manipulation is strictly forbidden
  const headerTenant = c.req.header('X-GEV-Tenant');
  if (headerTenant && headerTenant !== opsTenantId) {
    return {
      authorized: false,
      response: c.json(
        {
          code: 'TENANT_ACCESS_DENIED',
          error: 'Cross-tenant credential administration is forbidden',
        },
        403
      ),
    };
  }

  return {
    authorized: true,
    admin: {
      tenantId: opsTenantId,
      principal: opsPrincipal,
    },
  };
}

export interface LayerAccessAdminEnv {
  Variables: {
    adminIdentity: AdminIdentity;
  };
}

export function createLayerAccessAdminRouter(
  options: LayerAccessAdminRouterOptions
): Hono<LayerAccessAdminEnv> {
  const router = new Hono<LayerAccessAdminEnv>();
  const store = options.tenantLayerAccessStore;

  // Fail-closed admin authorization middleware: runs before all route handlers
  router.use('*', async (c, next) => {
    const auth = checkAdminAuthorization(c);
    if (!auth.authorized) {
      return auth.response;
    }
    c.set('adminIdentity', auth.admin);
    return await next();
  });

  async function auditedAction(
    c: Context<LayerAccessAdminEnv>,
    meta: { action: string; target: string; params: Record<string, unknown> },
    run: (
      admin: AdminIdentity,
      storeInstance: SqliteTenantLayerAccessStore
    ) => Promise<{ status?: 200 | 201; body: unknown; auditResult?: unknown }>
  ): Promise<Response> {
    const admin = c.get('adminIdentity') as AdminIdentity;

    // M4: Store resolved once in helper
    if (!store) {
      return c.json(
        { code: 'STORE_UNAVAILABLE', error: 'Tenant layer access store unavailable' },
        503
      );
    }

    const startedAt = options.clock.now();
    const intentId = crypto.randomUUID();
    const ref = taskRef(c.req.header('X-Task-Ref'));

    // H3: Guarded audit intent with principal attribution in params
    try {
      options.auditSink.intent({
        kind: GevEvents.AuditIntent,
        id: intentId,
        ts: new Date(startedAt).toISOString(),
        actor: 'human',
        action: meta.action,
        target: meta.target,
        params: {
          ...meta.params,
          tenant_id: admin.tenantId,
          principal: admin.principal,
        },
        task_ref: ref,
      });
    } catch {
      return c.json({ code: 'AUDIT_SINK_FAILURE', error: 'Failed to record audit intent' }, 500);
    }

    try {
      const result = await run(admin, store);
      const endedAt = options.clock.now();
      options.auditSink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: new Date(endedAt).toISOString(),
        status: 'ok',
        result: (result.auditResult ?? result.body) as Record<string, unknown>,
        duration_ms: endedAt - startedAt,
      });
      return c.json(result.body, result.status ?? 200);
    } catch (error) {
      const endedAt = options.clock.now();
      const rawMessage = error instanceof Error ? error.message : String(error);
      const isNotFound =
        rawMessage.toLowerCase().includes('not found') ||
        rawMessage.toLowerCase().includes('no credential');
      const isInvalid =
        rawMessage.toLowerCase().includes('invalid') ||
        rawMessage.toLowerCase().includes('cannot validate') ||
        rawMessage.toLowerCase().includes('revoked');
      const httpStatus = isNotFound ? 404 : isInvalid ? 400 : 500;
      const errCode = isNotFound ? 'NOT_FOUND' : isInvalid ? 'INVALID_REQUEST' : 'INTERNAL_ERROR';

      // M1: Distinguish operational failure ('error') from policy block ('blocked')
      options.auditSink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: new Date(endedAt).toISOString(),
        status: isNotFound || isInvalid ? 'blocked' : 'error',
        error: rawMessage,
        duration_ms: endedAt - startedAt,
      });
      return c.json({ code: errCode, error: rawMessage }, httpStatus);
    }
  }

  // POST /credentials — submit or rotate credential
  router.post('/credentials', async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = TenantLayerCredentialSubmissionSchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ code: 'INVALID_REQUEST', error: parsed.error.format() }, 400);
    }
    return auditedAction(
      c,
      {
        action: 'layer_access.credential_submit',
        target: `provider:${parsed.data.provider_id}`,
        params: {
          provider_id: parsed.data.provider_id,
          secret_kind: parsed.data.secret_kind,
        },
      },
      async (admin, s) => {
        const record = s.submitCredential(admin.tenantId, parsed.data, admin.principal);
        return {
          status: 200,
          body: record,
          auditResult: {
            provider_id: record.provider_id,
            masked_fingerprint: record.masked_fingerprint,
            status: record.status,
          },
        };
      }
    );
  });

  // POST /credentials/validate — validate credential (bounded <= 5s)
  router.post('/credentials/validate', async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = TenantLayerCredentialValidationRequestSchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ code: 'INVALID_REQUEST', error: parsed.error.format() }, 400);
    }
    return auditedAction(
      c,
      {
        action: 'layer_access.credential_validate',
        target: `provider:${parsed.data.provider_id}`,
        params: {
          provider_id: parsed.data.provider_id,
        },
      },
      async (admin, s) => {
        // H5: Bounded <= 5s validation with configured validator
        const record = await s.validateCredential(
          admin.tenantId,
          parsed.data.provider_id,
          options.credentialValidator,
          { timeoutMs: 5_000 }
        );
        return {
          status: 200,
          body: record,
          auditResult: {
            provider_id: record.provider_id,
            status: record.status,
            validation_error: record.validation_error,
          },
        };
      }
    );
  });

  // POST /credentials/revoke — revoke credential
  router.post('/credentials/revoke', async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = TenantLayerCredentialRevocationSchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ code: 'INVALID_REQUEST', error: parsed.error.format() }, 400);
    }
    return auditedAction(
      c,
      {
        action: 'layer_access.credential_revoke',
        target: `provider:${parsed.data.provider_id}`,
        params: {
          provider_id: parsed.data.provider_id,
          reason: parsed.data.reason,
        },
      },
      async (admin, s) => {
        const record = s.revokeCredential(
          admin.tenantId,
          parsed.data.provider_id,
          parsed.data.reason,
          admin.principal
        );
        return {
          status: 200,
          body: record,
          auditResult: {
            provider_id: record.provider_id,
            status: record.status,
            revoked_at: record.revoked_at,
          },
        };
      }
    );
  });

  // DELETE /credentials/:providerId — delete credential record
  router.delete('/credentials/:providerId', async (c) => {
    // H4: Validate providerId path parameter against ProviderRegistryIdSchema
    const parsedProvider = ProviderRegistryIdSchema.safeParse(c.req.param('providerId'));
    if (!parsedProvider.success) {
      return c.json({ code: 'INVALID_REQUEST', error: 'Invalid provider_id path parameter' }, 400);
    }
    const providerId = parsedProvider.data;

    return auditedAction(
      c,
      {
        action: 'layer_access.credential_delete',
        target: `provider:${providerId}`,
        params: { provider_id: providerId },
      },
      async (admin, s) => {
        const deleted = s.deleteCredential(admin.tenantId, providerId, admin.principal);
        // M6: Return 404 if no record existed to delete
        if (!deleted) {
          throw new Error(`No credential record found for provider '${providerId}'`);
        }
        return {
          status: 200,
          body: { deleted: true, provider_id: providerId },
          auditResult: { deleted: true, provider_id: providerId },
        };
      }
    );
  });

  // POST /terms — accept versioned terms
  router.post('/terms', async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = TenantLayerTermsAcceptanceSchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ code: 'INVALID_REQUEST', error: parsed.error.format() }, 400);
    }
    return auditedAction(
      c,
      {
        action: 'layer_access.terms_accept',
        target: `provider:${parsed.data.provider_id}`,
        params: {
          provider_id: parsed.data.provider_id,
          terms_id: parsed.data.terms_id,
          reviewed_url: parsed.data.reviewed_url,
          version_digest: parsed.data.version_digest,
        },
      },
      async (admin, s) => {
        const record = s.acceptTerms(admin.tenantId, parsed.data, admin.principal);
        return {
          status: 200,
          body: record,
          auditResult: {
            provider_id: record.provider_id,
            status: record.status,
            version_digest: record.version_digest,
          },
        };
      }
    );
  });

  // POST /terms/revoke — revoke terms acceptance
  router.post('/terms/revoke', async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = TenantLayerTermsRevocationSchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ code: 'INVALID_REQUEST', error: parsed.error.format() }, 400);
    }
    return auditedAction(
      c,
      {
        action: 'layer_access.terms_revoke',
        target: `provider:${parsed.data.provider_id}`,
        params: {
          provider_id: parsed.data.provider_id,
          reason: parsed.data.reason,
        },
      },
      async (admin, s) => {
        const record = s.revokeTerms(
          admin.tenantId,
          parsed.data.provider_id,
          parsed.data.reason,
          admin.principal
        );
        return {
          status: 200,
          body: record,
          auditResult: {
            provider_id: record.provider_id,
            status: record.status,
            revoked_at: record.revoked_at,
          },
        };
      }
    );
  });

  return router;
}
