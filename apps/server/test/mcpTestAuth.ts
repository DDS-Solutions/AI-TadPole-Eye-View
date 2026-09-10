import type {
  McpAuthorizationContext,
  McpBearerVerificationRequest,
  McpBearerVerifier,
} from '@gev/contracts/mcp-authorization';
import { SignJWT, jwtVerify } from 'jose';
import { MCP_HTTP_RESOURCE, MCP_TEST_ISSUER, MCP_TEST_SUBJECT } from '../src/routes/mcp.js';

export const MCP_TEST_NOW = 1_700_000_000_000;
export const MCP_TEST_ACCESS_TOKEN = 'deterministic-task-6-3-token';
export const MCP_TEST_AUTHORIZATION = `Bearer ${MCP_TEST_ACCESS_TOKEN}`;
export const MCP_TEST_SIGNING_KEY = new TextEncoder().encode(
  'task-6.3-deterministic-signing-key-32-bytes'
);
export const MCP_TEST_OTHER_SIGNING_KEY = new TextEncoder().encode(
  'task-6.3-wrong-deterministic-key-32-bytes'
);

export function testMcpAuthorization(
  overrides: Partial<McpAuthorizationContext> = {}
): McpAuthorizationContext {
  return {
    actor: 'ai',
    principal: MCP_TEST_SUBJECT,
    tenant_id: 'tenant-test',
    task_ref: 'task-6.3-test',
    issuer: MCP_TEST_ISSUER,
    audience: MCP_HTTP_RESOURCE,
    resource: MCP_HTTP_RESOURCE,
    scopes: ['read.telemetry', 'read.audit', 'write.scenes', 'write.flags'],
    issued_at_epoch_seconds: MCP_TEST_NOW / 1000 - 60,
    not_before_epoch_seconds: MCP_TEST_NOW / 1000 - 60,
    expires_at_epoch_seconds: MCP_TEST_NOW / 1000 + 60,
    ...overrides,
  };
}

export function fixedMcpBearerVerifier(
  authorities: Readonly<Record<string, unknown>> = {
    [MCP_TEST_ACCESS_TOKEN]: testMcpAuthorization(),
  }
): McpBearerVerifier {
  return {
    async verify(request) {
      if (!(request.access_token in authorities)) {
        throw new Error('invalid token');
      }
      return authorities[request.access_token];
    },
  };
}

export interface SignedMcpTokenOptions {
  algorithm?: 'HS256' | 'HS384';
  issuer?: string;
  audience?: string | string[];
  resource?: string;
  principal?: string;
  tenantId?: string;
  taskRef?: string;
  scopes?: readonly string[];
  issuedAt?: number;
  notBefore?: number;
  expiresAt?: number;
  signingKey?: Uint8Array;
}

export async function issueSignedMcpToken(options: SignedMcpTokenOptions = {}): Promise<string> {
  const issuedAt = options.issuedAt ?? MCP_TEST_NOW / 1000 - 60;
  return new SignJWT({
    tenant_id: options.tenantId ?? 'tenant-test',
    task_ref: options.taskRef ?? 'task-6.3-signed-test',
    resource: options.resource ?? MCP_HTTP_RESOURCE,
    scope: (options.scopes ?? ['read.telemetry']).join(' '),
  })
    .setProtectedHeader({ alg: options.algorithm ?? 'HS256', typ: 'JWT' })
    .setIssuer(options.issuer ?? MCP_TEST_ISSUER)
    .setSubject(options.principal ?? MCP_TEST_SUBJECT)
    .setAudience(options.audience ?? MCP_HTTP_RESOURCE)
    .setIssuedAt(issuedAt)
    .setNotBefore(options.notBefore ?? issuedAt)
    .setExpirationTime(options.expiresAt ?? MCP_TEST_NOW / 1000 + 60)
    .sign(options.signingKey ?? MCP_TEST_SIGNING_KEY);
}

export function joseMcpBearerVerifier(
  signingKey: Uint8Array = MCP_TEST_SIGNING_KEY
): McpBearerVerifier {
  return {
    async verify(request: McpBearerVerificationRequest) {
      const { payload } = await jwtVerify(request.access_token, signingKey, {
        algorithms: ['HS256'],
        issuer: MCP_TEST_ISSUER,
        audience: request.audience,
        currentDate: new Date(request.now_epoch_seconds * 1000),
      });
      if (payload.resource !== request.resource) {
        throw new Error('invalid resource');
      }
      if (payload.aud !== request.audience) {
        throw new Error('invalid audience');
      }
      const scopes =
        typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [];
      return {
        actor: 'ai',
        principal: payload.sub,
        tenant_id: payload.tenant_id,
        task_ref: payload.task_ref,
        issuer: payload.iss,
        audience: payload.aud,
        resource: payload.resource,
        scopes,
        issued_at_epoch_seconds: payload.iat,
        not_before_epoch_seconds: payload.nbf,
        expires_at_epoch_seconds: payload.exp,
      };
    },
  };
}
