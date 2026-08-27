import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpsAuth, timingSafeTokenMatches } from '../src/middleware/opsAuth.js';

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
      actor: 'local-dev',
    });
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
