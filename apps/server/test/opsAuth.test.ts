import { FrozenClock } from '@gev/core';
import { type AuthenticatedIdentityContext, GEV_PRODUCTION_IDENTITY_PROFILE } from '@gev/contracts';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  InMemoryRateLimiter,
  createOpsAuth,
  timingSafeTokenMatches,
} from '../src/middleware/opsAuth.js';

describe('shared privileged server authentication adapter', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('authenticates valid bearer credentials and rejects missing or invalid credentials', () => {
    const auth = createOpsAuth({ opsToken: 'configured-ops-token', requireAuth: true });

    expect(auth.authorize('Bearer configured-ops-token')).toMatchObject({
      kind: 'authenticated',
      allowed: true,
      authenticated: true,
    });
    expect(auth.authorize()).toMatchObject({
      kind: 'denied',
      status: 401,
      code: 'MISSING_BEARER_TOKEN',
    });
    expect(auth.authorize('Bearer invalid-token')).toMatchObject({
      kind: 'denied',
      status: 401,
      code: 'INVALID_BEARER_TOKEN',
    });
  });

  it('resolves environment configuration once during composition', () => {
    vi.stubEnv('GEV_OPS_TOKEN', 'initial-ops-token');
    const auth = createOpsAuth({ requireAuth: true });
    vi.stubEnv('GEV_OPS_TOKEN', 'replacement-ops-token');

    expect(auth.authorize('Bearer initial-ops-token').kind).toBe('authenticated');
    expect(auth.authorize('Bearer replacement-ops-token')).toMatchObject({
      kind: 'denied',
      code: 'INVALID_BEARER_TOKEN',
    });
  });

  it('fails closed in production even when an auth opt-out is present', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('GEV_REQUIRE_AUTH', '0');
    vi.stubEnv('GEV_OPS_TOKEN', '');

    const auth = createOpsAuth({ requireAuth: false });

    expect(auth.config).toEqual({ configured: false, requireAuth: true });
    expect(auth.authorize()).toMatchObject({
      kind: 'denied',
      status: 503,
      code: 'AUTH_NOT_CONFIGURED',
    });
  });

  it('keeps explicit local seed mode available without treating it as authenticated', () => {
    const auth = createOpsAuth({ opsToken: '', requireAuth: false });

    expect(auth.authorize()).toEqual({
      kind: 'local_seed',
      allowed: true,
      authenticated: false,
      actor: 'system',
    });
  });

  function verifiedIdentity(
    overrides: Partial<AuthenticatedIdentityContext> = {}
  ): AuthenticatedIdentityContext {
    return {
      actor: 'human',
      principal: 'auth0|operator-1',
      tenant_id: 'org_alpha',
      role: 'operator',
      client_id: 'gev-web',
      token_id: 'token-operator-1',
      issuer: GEV_PRODUCTION_IDENTITY_PROFILE.issuer,
      audience: GEV_PRODUCTION_IDENTITY_PROFILE.rest_resource,
      resource: GEV_PRODUCTION_IDENTITY_PROFILE.rest_resource,
      scopes: ['read.telemetry'],
      issued_at_epoch_seconds: 1_699_999_940,
      not_before_epoch_seconds: 1_699_999_940,
      expires_at_epoch_seconds: 1_700_000_060,
      session_id: 'session-operator-1',
      ...overrides,
    };
  }

  it('normalizes an injected production identity without exposing the bearer credential', async () => {
    const auth = createOpsAuth({
      requireAuth: true,
      clock: new FrozenClock(1_700_000_000_000),
      bearerVerifier: { verify: async () => verifiedIdentity() },
    });

    await expect(
      auth.authenticate('Bearer signed-access-token', 'org_alpha', {
        allowedRoles: ['operator'],
      })
    ).resolves.toMatchObject({
      kind: 'authenticated',
      actor: 'human',
      identity: {
        principal: 'auth0|operator-1',
        tenant_id: 'org_alpha',
        role: 'operator',
      },
    });
    expect(JSON.stringify(await auth.authenticate('Bearer signed-access-token'))).not.toContain(
      'signed-access-token'
    );
  });

  it.each([
    ['wrong issuer', { issuer: 'https://wrong.gev.test/' }, undefined, 'INVALID_BEARER_TOKEN'],
    ['expired', { expires_at_epoch_seconds: 1_700_000_000 }, undefined, 'INVALID_BEARER_TOKEN'],
    ['future', { not_before_epoch_seconds: 1_700_000_001 }, undefined, 'INVALID_BEARER_TOKEN'],
    ['wrong tenant', {}, 'org_other', 'TENANT_ACCESS_DENIED'],
    ['wrong role', { role: 'viewer' as const }, undefined, 'ROLE_ACCESS_DENIED'],
  ])('fails %s before resource dispatch', async (_label, overrides, tenant, code) => {
    const auth = createOpsAuth({
      requireAuth: true,
      clock: new FrozenClock(1_700_000_000_000),
      bearerVerifier: { verify: async () => verifiedIdentity(overrides) },
    });
    await expect(
      auth.authenticate('Bearer signed-access-token', tenant, { allowedRoles: ['operator'] })
    ).resolves.toMatchObject({ kind: 'denied', code });
  });

  it('fails closed when the required verifier rejects a revoked credential', async () => {
    const auth = createOpsAuth({
      requireAuth: true,
      clock: new FrozenClock(1_700_000_000_000),
      bearerVerifier: {
        verify: async () => {
          throw new Error('revoked');
        },
      },
    });
    await expect(auth.authenticate('Bearer revoked-token')).resolves.toMatchObject({
      kind: 'denied',
      code: 'INVALID_BEARER_TOKEN',
    });
  });

  it('keeps concurrent and repeated REST identities request-local', async () => {
    const auth = createOpsAuth({
      requireAuth: true,
      clock: new FrozenClock(1_700_000_000_000),
      bearerVerifier: {
        verify: async ({ access_token }) => {
          await Promise.resolve();
          return access_token === 'tenant-alpha-token'
            ? verifiedIdentity()
            : verifiedIdentity({
                principal: 'auth0|operator-2',
                tenant_id: 'org_beta',
                token_id: 'token-operator-2',
                session_id: 'session-operator-2',
              });
        },
      },
    });

    const [alpha, beta, alphaReconnect] = await Promise.all([
      auth.authenticate('Bearer tenant-alpha-token', 'org_alpha', {
        allowedRoles: ['operator'],
      }),
      auth.authenticate('Bearer tenant-beta-token', 'org_beta', {
        allowedRoles: ['operator'],
      }),
      auth.authenticate('Bearer tenant-alpha-token', 'org_alpha', {
        allowedRoles: ['operator'],
      }),
    ]);

    expect(alpha).toMatchObject({ identity: { principal: 'auth0|operator-1' } });
    expect(beta).toMatchObject({
      identity: { principal: 'auth0|operator-2', tenant_id: 'org_beta' },
    });
    expect(alphaReconnect).toMatchObject({
      identity: { principal: 'auth0|operator-1', tenant_id: 'org_alpha' },
    });
  });

  it('PROPERTY: every distinct well-formed requested tenant fails ownership', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .stringMatching(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/)
          .filter((tenant) => tenant !== 'org_alpha'),
        async (tenant) => {
          const auth = createOpsAuth({
            requireAuth: true,
            clock: new FrozenClock(1_700_000_000_000),
            bearerVerifier: { verify: async () => verifiedIdentity() },
          });
          await expect(
            auth.authenticate('Bearer signed-access-token', tenant, {
              allowedRoles: ['operator', 'tenant_admin', 'platform_admin'],
            })
          ).resolves.toMatchObject({ kind: 'denied', code: 'TENANT_ACCESS_DENIED' });
        }
      )
    );
  });

  it('enforces independent clock-driven per-client limits and resets each minute', () => {
    const clock = new FrozenClock();
    const limiter = new InMemoryRateLimiter(clock);

    for (let count = 0; count < 5; count += 1) {
      expect(limiter.consume('voice-session', 'client-a', 5).allowed).toBe(true);
    }
    expect(limiter.consume('voice-session', 'client-a', 5)).toMatchObject({
      allowed: false,
      retryAfterSeconds: 60,
    });

    for (const bucket of ['collab-join', 'collab-ws-upgrade']) {
      for (let count = 0; count < 20; count += 1) {
        expect(limiter.consume(bucket, 'client-a', 20).allowed).toBe(true);
      }
      expect(limiter.consume(bucket, 'client-a', 20).allowed).toBe(false);
    }

    clock.setTime(clock.now() + 60_000);
    expect(limiter.consume('voice-session', 'client-a', 5).allowed).toBe(true);
    expect(limiter.consume('voice-session', 'client-b', 5).allowed).toBe(true);
  });

  it('PROPERTY: exact arbitrary token values compare successfully', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 512 }), (token) => {
        expect(timingSafeTokenMatches(token, token)).toBe(true);
      })
    );
  });

  it('PROPERTY: arbitrary unequal token values never compare successfully or throw', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 512 }),
        fc.string({ maxLength: 512 }),
        (presented, expected) => {
          fc.pre(presented !== expected);
          expect(() => timingSafeTokenMatches(presented, expected)).not.toThrow();
          expect(timingSafeTokenMatches(presented, expected)).toBe(false);
        }
      )
    );
  });
});
