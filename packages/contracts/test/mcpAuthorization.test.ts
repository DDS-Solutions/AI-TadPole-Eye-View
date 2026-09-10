import { describe, expect, it } from 'vitest';
import {
  McpAuthorizationContextSchema,
  McpBearerVerificationRequestSchema,
} from '../src/mcpAuthorization.js';

const RESOURCE = 'http://127.0.0.1:3000/mcp';

function validAuthorization() {
  return {
    actor: 'ai' as const,
    principal: 'svc:tadpole-test',
    tenant_id: 'tenant-test',
    task_ref: 'task-6.3-test',
    issuer: 'https://auth.gev.test/',
    audience: RESOURCE,
    resource: RESOURCE,
    scopes: ['read.telemetry', 'read.audit'],
    issued_at_epoch_seconds: 1_699_999_900,
    not_before_epoch_seconds: 1_699_999_900,
    expires_at_epoch_seconds: 1_700_000_100,
  };
}

describe('MCP authorization contracts', () => {
  it('accepts one bounded AI principal, tenant, task, resource, and unique scope set', () => {
    expect(McpAuthorizationContextSchema.parse(validAuthorization())).toMatchObject({
      principal: 'svc:tadpole-test',
      tenant_id: 'tenant-test',
      scopes: ['read.telemetry', 'read.audit'],
    });
  });

  it.each([
    { principal: `svc:${'p'.repeat(125)}` },
    { tenant_id: 't'.repeat(129) },
    { task_ref: ' task-6.3-test' },
    { scopes: ['read.telemetry', 'unknown.scope'] },
    { scopes: ['read.telemetry', 'read.telemetry'] },
    { audience: 'http://127.0.0.1:3000/other' },
    { expires_at_epoch_seconds: 1_699_999_899 },
  ])('rejects malformed or unbounded verified authority %#', (override) => {
    expect(() =>
      McpAuthorizationContextSchema.parse({ ...validAuthorization(), ...override })
    ).toThrow();
  });

  it('bounds the opaque bearer input and requires matching audience/resource constraints', () => {
    expect(
      McpBearerVerificationRequestSchema.parse({
        access_token: 'signed-token',
        audience: RESOURCE,
        resource: RESOURCE,
        now_epoch_seconds: 1_700_000_000,
      })
    ).toMatchObject({ access_token: 'signed-token' });
    expect(() =>
      McpBearerVerificationRequestSchema.parse({
        access_token: 'x'.repeat(8_193),
        audience: RESOURCE,
        resource: RESOURCE,
        now_epoch_seconds: 1_700_000_000,
      })
    ).toThrow();
  });
});
