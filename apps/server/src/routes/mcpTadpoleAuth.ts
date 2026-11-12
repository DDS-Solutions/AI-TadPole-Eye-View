import type { McpAuthorizationContext } from '@gev/contracts/mcp-authorization';
import type { TadpoleCapabilityIssuer, TadpoleConnectionLifecycle } from '@gev/governance';

export type TadpoleHeaderPropagationResult =
  | { allowed: true; authorization: McpAuthorizationContext }
  | { allowed: false; code: 'invalid_token' | 'insufficient_scope' };

export function narrowMcpAuthorizationFromTadpoleHeaders(params: {
  authorization: McpAuthorizationContext;
  rawCapToken: string | undefined;
  rawSessionId: string | undefined;
  capabilityIssuer?: TadpoleCapabilityIssuer;
  connectionLifecycle?: TadpoleConnectionLifecycle;
}): TadpoleHeaderPropagationResult {
  let { authorization } = params;
  const { rawCapToken, rawSessionId, capabilityIssuer, connectionLifecycle } = params;

  if (rawCapToken && capabilityIssuer) {
    const claims = capabilityIssuer.verifyWithClaims(rawCapToken);
    if (!claims || claims.sub !== authorization.principal) {
      return { allowed: false, code: 'invalid_token' };
    }
    const tokenScopes = new Set(claims.scopes);
    const narrowed = authorization.scopes.filter((s) => tokenScopes.has(s));
    if (narrowed.length === 0) {
      return { allowed: false, code: 'insufficient_scope' };
    }
    authorization = Object.freeze({
      ...authorization,
      scopes: Object.freeze(narrowed) as [(typeof narrowed)[0], ...(typeof narrowed)[number][]],
    }) as McpAuthorizationContext;
  }

  if (rawSessionId && connectionLifecycle) {
    if (!rawCapToken) {
      return { allowed: false, code: 'invalid_token' };
    }
    try {
      const propagated = connectionLifecycle.propagateCapabilities(rawSessionId, rawCapToken, []);
      if (
        propagated.session.principal !== authorization.principal ||
        propagated.session.tenant_id !== authorization.tenant_id
      ) {
        return { allowed: false, code: 'invalid_token' };
      }
      const propSet = new Set(propagated.effectiveScopes);
      const narrowed = authorization.scopes.filter((s) => propSet.has(s));
      if (narrowed.length === 0) {
        return { allowed: false, code: 'insufficient_scope' };
      }
      authorization = Object.freeze({
        ...authorization,
        scopes: Object.freeze(narrowed) as [(typeof narrowed)[0], ...(typeof narrowed)[number][]],
      }) as McpAuthorizationContext;
    } catch {
      return { allowed: false, code: 'invalid_token' };
    }
  }

  return { allowed: true, authorization };
}
