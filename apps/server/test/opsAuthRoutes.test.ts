import { createGovernanceRuntimeContext } from '@gev/governance';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/index.js';

const OPS_TOKEN = 'route-coverage-ops-token';

const PROTECTED_OPS_ROUTES = [
  { method: 'GET', path: '/ops/audit/integrity' },
  { method: 'GET', path: '/ops/audit/stream' },
  { method: 'GET', path: '/ops/layer-access' },
  { method: 'POST', path: '/ops/budget/reconcile' },
  { method: 'POST', path: '/ops/cables/packs/activate' },
  { method: 'POST', path: '/ops/seed/reload' },
  { method: 'GET', path: '/ops/audit' },
  { method: 'GET', path: '/ops/status' },
  { method: 'POST', path: '/ops/resume' },
] as const;

function createProtectedApp() {
  return createApp({
    opsAuth: {
      opsToken: OPS_TOKEN,
      requireAuth: true,
    },
  });
}

const IDENTITY_NOW = 1_700_000_000_000;

function identityForRole(role: IdentityRole): AuthenticatedIdentityContext {
  const ai = role === 'ai_copilot';
  return {
    actor: ai ? 'ai' : 'human',
    principal: ai ? 'svc:tadpole' : `auth0|${role}`,
    tenant_id: 'org_alpha',
    role,
    client_id: ai ? 'ai-tadpole-os' : 'gev-web',
    token_id: `token-${role}`,
    issuer: GEV_PRODUCTION_IDENTITY_PROFILE.issuer,
    audience: GEV_PRODUCTION_IDENTITY_PROFILE.rest_resource,
    resource: GEV_PRODUCTION_IDENTITY_PROFILE.rest_resource,
    scopes: ['read.telemetry', 'read.audit', 'write.scenes', 'write.flags'],
    issued_at_epoch_seconds: IDENTITY_NOW / 1000 - 60,
    not_before_epoch_seconds: IDENTITY_NOW / 1000 - 60,
    expires_at_epoch_seconds: IDENTITY_NOW / 1000 + 60,
  };
}

function createIdentityApp() {
  return createApp({
    clock: new FrozenClock(IDENTITY_NOW),
    opsAuth: { requireAuth: true },
    identityBearerVerifier: {
      async verify(request) {
        const role = request.access_token as IdentityRole;
        return identityForRole(role);
      },
    },
  });
}

describe('operations route authentication coverage', () => {
  it('keeps the route-coverage table synchronized with every registered /ops handler', () => {
    const { app, auditSink } = createProtectedApp();

    try {
      const registeredOpsRoutes = app.routes
        .filter((route) => route.method !== 'ALL' && route.path.startsWith('/ops/'))
        .map(({ method, path }) => ({ method, path }));

      expect(registeredOpsRoutes).toEqual(PROTECTED_OPS_ROUTES);
    } finally {
      auditSink.close();
    }
  });

  it.each(PROTECTED_OPS_ROUTES)(
    '$method $path rejects a missing bearer credential',
    async ({ method, path }) => {
      const { app, auditSink } = createProtectedApp();

      try {
        const response = await app.request(path, { method });

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: 'MISSING_BEARER_TOKEN' });
      } finally {
        auditSink.close();
      }
    }
  );

  const OWNERSHIP_MATRIX = PROTECTED_OPS_ROUTES.flatMap((route) =>
    (['viewer', 'operator', 'tenant_admin', 'platform_admin', 'ai_copilot'] as const).map(
      (role) => ({
        ...route,
        role,
        allowed:
          role === 'platform_admin' ||
          ((route.path === '/ops/status' || route.path === '/ops/layer-access') &&
            (role === 'operator' || role === 'tenant_admin')),
      })
    )
  );

  it.each(OWNERSHIP_MATRIX)(
    '$method $path applies the $role resource role policy',
    async ({ method, path, role, allowed }) => {
      const context = createIdentityApp();
      try {
        const response = await context.app.request(path, {
          method,
          headers: {
            Authorization: `Bearer ${role}`,
            'X-GEV-Tenant': 'org_alpha',
          },
        });
        if (path === '/ops/audit/stream' && allowed) await response.body?.cancel();
        expect([401, 403].includes(response.status), `${role} ${method} ${path}`).toBe(!allowed);
      } finally {
        context.governanceContext.close();
      }
    }
  );

  it('rejects cross-tenant ownership before audit, body parsing, or mutation', async () => {
    const context = createIdentityApp();
    try {
      const response = await context.app.request('/ops/seed/reload', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer platform_admin',
          'X-GEV-Tenant': 'org_other',
          'X-Task-Ref': 'cross-tenant-attempt',
          'Content-Type': 'application/json',
        },
        body: '{',
      });
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ code: 'TENANT_ACCESS_DENIED' });
      expect(context.auditSink.tailByTaskRef('cross-tenant-attempt')).toEqual([]);
      expect(context.budgetGovernor.state().spent_usd).toBe(0);
    } finally {
      context.governanceContext.close();
    }
  });

  it.each(PROTECTED_OPS_ROUTES)(
    '$method $path rejects an invalid bearer credential',
    async ({ method, path }) => {
      const { app, auditSink } = createProtectedApp();

      try {
        const response = await app.request(path, {
          method,
          headers: { Authorization: 'Bearer invalid-ops-token' },
        });

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_BEARER_TOKEN' });
      } finally {
        auditSink.close();
      }
    }
  );

  it.each(PROTECTED_OPS_ROUTES)(
    '$method $path retains its existing behavior for an authorized operator',
    async ({ method, path }) => {
      const { app, auditSink } = createProtectedApp();

      try {
        const response = await app.request(path, {
          method,
          headers: { Authorization: `Bearer ${OPS_TOKEN}` },
        });

        expect(response.status).toBe(
          path === '/ops/budget/reconcile' || path === '/ops/cables/packs/activate' ? 400 : 200
        );
        if (path === '/ops/audit/stream') {
          expect(response.headers.get('content-type')).toContain('text/event-stream');
          await response.body?.cancel();
        }
      } finally {
        auditSink.close();
      }
    }
  );

  it('fails closed when authentication is required without a configured token', async () => {
    const { app, auditSink } = createApp({
      opsAuth: {
        opsToken: '',
        requireAuth: true,
      },
    });

    try {
      const response = await app.request('/ops/status');

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({ code: 'AUTH_NOT_CONFIGURED' });
    } finally {
      auditSink.close();
    }
  });

  it('authenticates seed reload before audit intent or governance checks run', async () => {
    const { app, auditSink, budgetGovernor } = createProtectedApp();
    const taskRef = 'task-unauthorized-seed-reload';

    try {
      const response = await app.request('/ops/seed/reload', {
        method: 'POST',
        headers: { 'X-Task-Ref': taskRef },
      });

      expect(response.status).toBe(401);
      expect(auditSink.tailByTaskRef(taskRef)).toEqual([]);
      expect(budgetGovernor.state().spent_usd).toBe(0);
    } finally {
      auditSink.close();
    }
  });

  it('keeps an authorized seed reload on the fixture path with zero outbound calls', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Outbound HTTP is forbidden in this test'));
    const { app, auditSink } = createProtectedApp();

    try {
      const response = await app.request('/ops/seed/reload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPS_TOKEN}` },
      });

      expect(response.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      auditSink.close();
      fetchSpy.mockRestore();
    }
  });

  it('records one error outcome and never reloads when approval verification is unavailable', async () => {
    const runtime = createGovernanceRuntimeContext({
      approvalGate: {
        request: async () => {
          throw new Error('invalid signed approval');
        },
      },
    });
    const context = createApp({
      governanceContext: runtime,
      opsAuth: { opsToken: OPS_TOKEN, requireAuth: true },
    });
    const taskRef = 'task-approval-verification-failure';

    try {
      const response = await context.app.request('/ops/seed/reload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPS_TOKEN}`, 'X-Task-Ref': taskRef },
      });
      expect(response.status).toBe(503);
      const result = (await response.json()) as { code: string; intent_id: string };
      expect(result).toMatchObject({ code: 'APPROVAL_UNAVAILABLE' });
      expect(runtime.budgetLedger.lookup(result.intent_id)?.state).toBe('REFUNDED');
      expect(runtime.budgetGovernor.state().spent_usd).toBe(0);
      const entries = runtime.auditSink.tailByTaskRef(taskRef);
      expect(entries.map((entry) => entry.kind)).toEqual(['audit.intent', 'audit.outcome']);
      expect(entries[1]).toMatchObject({ status: 'error' });
    } finally {
      runtime.close();
    }
  });

  it('replays one seed reload operation without a second approval, action, or settlement', async () => {
    const context = createProtectedApp();
    const operationId = '00000000-0000-4000-8000-000000000456';
    const request = () =>
      context.app.request('/ops/seed/reload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPS_TOKEN}`,
          'Idempotency-Key': operationId,
        },
      });
    try {
      const first = await request();
      const replay = await request();
      expect(first.status).toBe(200);
      expect(replay.status).toBe(200);
      await expect(replay.json()).resolves.toMatchObject({ intent_id: operationId, status: 'ok' });
      expect(context.budgetGovernor.state().spent_usd).toBe(0.05);
      expect(context.auditSink.tailByTaskRef(`seed-reload:${operationId}`)).toHaveLength(2);
    } finally {
      context.governanceContext.close();
    }
  });

  it('derives audit actors from authentication and ignores spoofed X-Actor values', async () => {
    const protectedContext = createProtectedApp();
    const localContext = createApp({ opsAuth: { opsToken: '', requireAuth: false } });

    try {
      const protectedTask = 'task-authenticated-actor';
      const protectedResponse = await protectedContext.app.request('/ops/seed/reload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPS_TOKEN}`,
          'X-Actor': 'ai',
          'X-Task-Ref': protectedTask,
        },
      });
      expect(protectedResponse.status).toBe(200);
      expect(protectedContext.auditSink.tailByTaskRef(protectedTask)[0]).toMatchObject({
        actor: 'human',
      });

      const localTask = 'task-local-actor';
      const localResponse = await localContext.app.request('/ops/seed/reload', {
        method: 'POST',
        headers: { 'X-Actor': 'human', 'X-Task-Ref': localTask },
      });
      expect(localResponse.status).toBe(401);
      expect(localContext.auditSink.tailByTaskRef(localTask)).toEqual([]);
    } finally {
      protectedContext.auditSink.close();
      localContext.auditSink.close();
    }
  });

  it('keeps STASIS active when tokenless local seed attempts a human-only resume', async () => {
    const context = createApp({ opsAuth: { opsToken: '', requireAuth: false } });
    context.budgetGovernor.trip('BUDGET_BREACH', 'test trip');

    try {
      const response = await context.app.request('/ops/resume', {
        method: 'POST',
        headers: { 'X-Actor': 'human', 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'spoofed local resume' }),
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ code: 'MISSING_BEARER_TOKEN' });
      expect(context.budgetGovernor.state().stasis_active).toBe(true);
      expect(context.auditSink.tailByTaskRef('ops-resume')).toEqual([]);
    } finally {
      context.auditSink.close();
    }
  });
  it('leaves the explicitly public health route outside the operations guard', async () => {
    const { app, auditSink } = createProtectedApp();

    try {
      const response = await app.request('/api/health');

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ status: 'ok' });
    } finally {
      auditSink.close();
    }
  });
});
import {
  type AuthenticatedIdentityContext,
  GEV_PRODUCTION_IDENTITY_PROFILE,
  type IdentityRole,
} from '@gev/contracts';
import { FrozenClock } from '@gev/core';
