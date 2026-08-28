import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/index.js';

const OPS_TOKEN = 'route-coverage-ops-token';

const PROTECTED_OPS_ROUTES = [
  { method: 'GET', path: '/ops/audit/stream' },
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

        expect(response.status).toBe(200);
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
      expect(localResponse.status).toBe(200);
      expect(localContext.auditSink.tailByTaskRef(localTask)[0]).toMatchObject({ actor: 'system' });
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

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ code: 'HUMAN_AUTH_REQUIRED' });
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
