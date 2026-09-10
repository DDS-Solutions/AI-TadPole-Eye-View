import type { CapabilityScope } from '@gev/contracts';
import {
  type McpAuthorizationContext,
  McpAuthorizationContextSchema,
  McpBearerVerificationRequestSchema,
  type McpBearerVerifier,
} from '@gev/contracts/mcp-authorization';
import {
  OAuthError,
  OAuthErrorCode,
  bearerAuthChallengeResponse,
} from '@modelcontextprotocol/server';

const BEARER_HEADER_PATTERN = /^Bearer ([A-Za-z0-9._~+/-]+={0,2})$/i;

export class McpBearerAuthenticationError extends Error {
  readonly code = 'invalid_token';
}

export interface McpBearerConstraints {
  audience: string;
  resource: string;
  nowEpochSeconds: number;
}

/** Parses and verifies a bearer credential without depending on an HTTP framework or SDK handler. */
export async function verifyMcpBearerAuthorization(
  authorizationHeader: string | null | undefined,
  verifier: McpBearerVerifier,
  constraints: McpBearerConstraints
): Promise<McpAuthorizationContext> {
  const match = authorizationHeader?.match(BEARER_HEADER_PATTERN);
  if (!match?.[1]) {
    throw new McpBearerAuthenticationError('Invalid access token');
  }

  const verificationRequest = McpBearerVerificationRequestSchema.safeParse({
    access_token: match[1],
    audience: constraints.audience,
    resource: constraints.resource,
    now_epoch_seconds: constraints.nowEpochSeconds,
  });
  if (!verificationRequest.success) {
    throw new McpBearerAuthenticationError('Invalid access token');
  }

  let rawContext: unknown;
  try {
    rawContext = await verifier.verify(Object.freeze(verificationRequest.data));
  } catch {
    throw new McpBearerAuthenticationError('Invalid access token');
  }

  const parsed = McpAuthorizationContextSchema.safeParse(rawContext);
  if (
    !parsed.success ||
    parsed.data.audience !== constraints.audience ||
    parsed.data.resource !== constraints.resource ||
    parsed.data.issued_at_epoch_seconds > constraints.nowEpochSeconds ||
    parsed.data.not_before_epoch_seconds > constraints.nowEpochSeconds ||
    parsed.data.expires_at_epoch_seconds <= constraints.nowEpochSeconds
  ) {
    throw new McpBearerAuthenticationError('Invalid access token');
  }

  return Object.freeze({
    ...parsed.data,
    scopes: Object.freeze([...parsed.data.scopes]),
  }) as McpAuthorizationContext;
}

export function mcpBearerChallengeResponse(
  code: 'invalid_token' | 'insufficient_scope',
  resourceMetadataUrl: string,
  requiredScopes: readonly CapabilityScope[] = []
): Response {
  const sdkCode =
    code === 'insufficient_scope' ? OAuthErrorCode.InsufficientScope : OAuthErrorCode.InvalidToken;
  const description = code === 'insufficient_scope' ? 'Insufficient scope' : 'Invalid access token';
  return bearerAuthChallengeResponse(new OAuthError(sdkCode, description), {
    resourceMetadataUrl,
    requiredScopes: [...requiredScopes],
  });
}
