import {
  AuthenticatedIdentityContextSchema,
  GEV_PRODUCTION_IDENTITY_PROFILE,
  authorizeTenantResource,
  identityIsCurrent,
} from '../src/identity.js';
import { describe, expect, it } from 'vitest';

const NOW = 1_700_000_000;

function humanIdentity(overrides: Record<string, unknown> = {}) {
  return {
    actor: 'human',
    principal: 'auth0|operator-1',
    tenant_id: 'org_test',
    role: 'operator',
    client_id: 'gev-web',
    token_id: 'token-1',
    issuer: GEV_PRODUCTION_IDENTITY_PROFILE.issuer,
    audience: GEV_PRODUCTION_IDENTITY_PROFILE.rest_resource,
    resource: GEV_PRODUCTION_IDENTITY_PROFILE.rest_resource,
    scopes: ['read.telemetry'],
    issued_at_epoch_seconds: NOW - 60,
    not_before_epoch_seconds: NOW - 60,
    expires_at_epoch_seconds: NOW + 60,
    session_id: 'session-1',
    ...overrides,
  };
}

describe('authenticated identity contract', () => {
  it('accepts one current human tenant membership and the approved production profile', () => {
    expect(AuthenticatedIdentityContextSchema.parse(humanIdentity())).toMatchObject({
      actor: 'human',
      tenant_id: 'org_test',
      role: 'operator',
      issuer: GEV_PRODUCTION_IDENTITY_PROFILE.issuer,
    });
  });

  it.each([
    ['unknown role', { role: 'owner' }],
    ['human AI role', { role: 'ai_copilot' }],
    ['AI human role', { actor: 'ai', role: 'operator' }],
    ['wrong resource', { resource: `${GEV_PRODUCTION_IDENTITY_PROFILE.rest_resource}/other` }],
    ['duplicate scopes', { scopes: ['read.telemetry', 'read.telemetry'] }],
    [
      'overlong lifetime',
      { issued_at_epoch_seconds: NOW - 60, expires_at_epoch_seconds: NOW + 241 },
    ],
    ['unknown private claim', { email: 'private@example.test' }],
  ])('rejects %s', (_label, override) => {
    expect(() => AuthenticatedIdentityContextSchema.parse(humanIdentity(override))).toThrow();
  });

  it('requires tenant ownership, an allowed role, and every capability', () => {
    const identity = AuthenticatedIdentityContextSchema.parse(humanIdentity());
    expect(
      authorizeTenantResource(identity, {
        tenant_id: 'org_test',
        allowed_roles: ['operator'],
        required_scopes: ['read.telemetry'],
      })
    ).toEqual({ allowed: true });
    expect(
      authorizeTenantResource(identity, {
        tenant_id: 'org_other',
        allowed_roles: ['operator'],
      })
    ).toEqual({ allowed: false, code: 'TENANT_ACCESS_DENIED' });
    expect(
      authorizeTenantResource(identity, {
        tenant_id: 'org_test',
        allowed_roles: ['tenant_admin'],
      })
    ).toEqual({ allowed: false, code: 'ROLE_ACCESS_DENIED' });
    expect(
      authorizeTenantResource(identity, {
        tenant_id: 'org_test',
        allowed_roles: ['operator'],
        required_scopes: ['read.audit'],
      })
    ).toEqual({
      allowed: false,
      code: 'INSUFFICIENT_SCOPE',
      missing_scopes: ['read.audit'],
    });
  });

  it('uses injected time for current, future, and expired decisions', () => {
    const current = AuthenticatedIdentityContextSchema.parse(humanIdentity());
    expect(identityIsCurrent(current, NOW)).toBe(true);
    expect(identityIsCurrent(current, NOW - 61)).toBe(false);
    expect(identityIsCurrent(current, NOW + 60)).toBe(false);
  });
});
