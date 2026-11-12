import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  type ApprovalRequest,
  type AuthenticatedIdentityContext,
  GEV_PRODUCTION_IDENTITY_PROFILE,
  type IdentityBearerVerifier,
} from '@gev/contracts';
import type { McpAuthorizationContext } from '@gev/contracts/mcp-authorization';
import { FrozenClock } from '@gev/core';
import {
  LocalSignedApprovalProvider,
  type SignedApprovalProvider,
  createGovernanceRuntimeContext,
  generateEd25519KeyPair,
  verifyIndependentAuditChain,
} from '@gev/governance';
import { afterEach, describe, expect, it } from 'vitest';
import { type CreatedApp, createApp } from '../src/index.js';
import { MCP_HTTP_HOST, MCP_HTTP_RESOURCE, MCP_TEST_ISSUER } from '../src/routes/mcp.js';

const NOW = 1_731_430_000_000;

function makeHumanIdentity(
  role: 'platform_admin' | 'operator' = 'platform_admin'
): AuthenticatedIdentityContext {
  const nowSec = Math.floor(NOW / 1000);
  return {
    actor: 'human',
    principal: `auth0|${role}-drill`,
    tenant_id: 'tenant-drill',
    role,
    client_id: 'gev-web',
    token_id: `human-${role}-1`,
    issuer: GEV_PRODUCTION_IDENTITY_PROFILE.issuer,
    audience: GEV_PRODUCTION_IDENTITY_PROFILE.rest_resource,
    resource: GEV_PRODUCTION_IDENTITY_PROFILE.rest_resource,
    scopes: ['read.telemetry', 'read.audit', 'write.flags'],
    issued_at_epoch_seconds: nowSec - 10,
    not_before_epoch_seconds: nowSec - 10,
    expires_at_epoch_seconds: nowSec + 240,
  };
}

function makeMcpAiIdentity(): McpAuthorizationContext {
  const nowSec = Math.floor(NOW / 1000);
  return {
    actor: 'ai',
    role: 'ai_copilot',
    principal: 'svc:tadpole-drill',
    tenant_id: 'tenant-drill',
    client_id: 'tadpole-runtime',
    token_id: 'mcp-drill-1',
    issuer: MCP_TEST_ISSUER,
    audience: MCP_HTTP_RESOURCE,
    resource: MCP_HTTP_RESOURCE,
    scopes: ['read.telemetry', 'read.audit', 'write.flags'],
    issued_at_epoch_seconds: nowSec - 10,
    not_before_epoch_seconds: nowSec - 10,
    expires_at_epoch_seconds: nowSec + 240,
    task_ref: 'task-12-3-http-drill',
  };
}

function mcpMeta(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientInfo': { name: 'tadpole-drill', version: '1.0.0' },
    'io.modelcontextprotocol/clientCapabilities': {},
    ...extra,
  };
}

describe('Task 12.3: HTTP Server & MCP Tadpole Failure Drills', () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it('rejects tampered/revoked CapTokens, refunds disconnected requests, propagates STASIS notification + 423 within 1 cycle, and enforces human-only resume', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-http-drill-'));
    const dbPath = path.join(dir, 'governance.sqlite');
    const clock = new FrozenClock(NOW);
    const approvalKeys = generateEd25519KeyPair();

    let pendingApprovalGate = false;
    let approvalStartedResolve: (() => void) | undefined;
    let releaseApprovalResolve: (() => void) | undefined;

    const baseProvider = new LocalSignedApprovalProvider({
      signerId: 'human:drill-admin',
      keyId: 'drill-ed25519-1',
      privateKeyPem: approvalKeys.privateKeyPem,
      policy: 'approve_all',
      clock,
    });

    const drillProvider: SignedApprovalProvider = {
      decide: async (request: ApprovalRequest) => {
        if (pendingApprovalGate) {
          approvalStartedResolve?.();
          await new Promise<void>((resolve) => {
            releaseApprovalResolve = resolve;
          });
        }
        return baseProvider.decide(request);
      },
    };

    const governanceContext = createGovernanceRuntimeContext({
      clock,
      dbPath,
      capUsd: 2.0,
      signedApproval: {
        trustedKeys: [
          {
            signerId: 'human:drill-admin',
            keyId: 'drill-ed25519-1',
            publicKeyPem: approvalKeys.publicKeyPem,
            status: 'active',
          },
        ],
        provider: drillProvider,
      },
    });

    const humanAdmin = makeHumanIdentity('platform_admin');
    const humanOperator = makeHumanIdentity('operator');
    const aiIdentity = makeMcpAiIdentity();

    const identityBearerVerifier: IdentityBearerVerifier = {
      verify: async ({ access_token }) => {
        if (access_token === 'human-admin-token') return humanAdmin;
        if (access_token === 'human-op-token') return humanOperator;
        return null;
      },
    };

    const created: CreatedApp = createApp({
      clock,
      governanceContext,
      identityBearerVerifier,
      mcpHttpEnabled: true,
      mcpHttpResponseMode: 'json',
      mcpHttpBearerVerifier: {
        verify: async ({ access_token }) => (access_token === 'ai-mcp-token' ? aiIdentity : null),
      },
    });
    cleanups.push(async () => {
      releaseApprovalResolve?.();
      await created.mcpHttp?.close();
      governanceContext.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
    });

    const capToken = governanceContext.capabilityIssuer.issue(
      aiIdentity.principal,
      ['read.telemetry', 'write.flags'],
      240
    );
    const session = governanceContext.connectionLifecycle.openSession({
      transport: 'http-2026-07-28',
      authorization: aiIdentity,
      capToken,
    });

    const mcpHeaders = (toolName: string, token = capToken.token, sessId = session.session_id) => ({
      host: MCP_HTTP_HOST,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      authorization: 'Bearer ai-mcp-token',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/call',
      'mcp-name': toolName,
      'x-tadpole-cap-token': token,
      'x-tadpole-session-id': sessId,
    });

    // 1. Tampered CapToken fails closed with 401 before SDK dispatch
    const tamperedRes = await created.app.request(MCP_HTTP_RESOURCE, {
      method: 'POST',
      headers: mcpHeaders('get_budget', `${capToken.token.slice(0, -4)}AAAA`),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'drill-tamper',
        method: 'tools/call',
        params: { name: 'get_budget', arguments: {}, _meta: mcpMeta() },
      }),
    });
    expect(tamperedRes.status).toBe(401);

    // 2. Unexpected Tadpole MCP disconnect while approval pending -> cancelled & refunded
    pendingApprovalGate = true;
    const approvalStarted = new Promise<void>((resolve) => {
      approvalStartedResolve = resolve;
    });
    const disconnectAbort = new AbortController();
    const disconnectedOpId = crypto.randomUUID();
    const inFlightPromise = created.app.request(MCP_HTTP_RESOURCE, {
      method: 'POST',
      headers: mcpHeaders('set_flag'),
      signal: disconnectAbort.signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'drill-disconnect',
        method: 'tools/call',
        params: {
          name: 'set_flag',
          arguments: { flag: 'opensky.enabled', enabled: false },
          _meta: mcpMeta({ operation_id: disconnectedOpId }),
        },
      }),
    });
    await approvalStarted;
    disconnectAbort.abort('client-disconnected');
    releaseApprovalResolve?.();
    await inFlightPromise.catch(() => undefined);
    pendingApprovalGate = false;

    const cancelledOp = governanceContext.budgetLedger.lookup(disconnectedOpId);
    expect(cancelledOp?.state).toBe('REFUNDED');

    // 3. Connect M1 /ops/audit/stream SSE listener BEFORE budget breach to observe STASIS notification
    const sseAbort = new AbortController();
    const sseRes = await created.app.request('/ops/audit/stream', {
      headers: { authorization: 'Bearer human-admin-token' },
      signal: sseAbort.signal,
    });
    expect(sseRes.status).toBe(200);
    const reader = sseRes.body?.getReader();
    const decoder = new TextDecoder();
    const readSseUntil = async (marker: string, maxChunks = 16): Promise<string> => {
      let buffer = '';
      for (let i = 0; i < maxChunks; i += 1) {
        const chunk = await reader?.read();
        if (chunk?.value) {
          buffer += decoder.decode(chunk.value);
        }
        if (buffer.includes(marker) || chunk?.done) {
          break;
        }
      }
      return buffer;
    };

    const initialSse = await readSseUntil('audit.connected', 4);
    expect(initialSse).toContain('audit.connected');

    // Breach budget ($2.00 cap): live SSE receives stasis.entered, session suspends, and next /mcp returns 423
    governanceContext.budgetGovernor.recordSpend(2.0);
    const sseStasisChunk = await readSseUntil('event: stasis.entered', 20);
    expect(sseStasisChunk).toContain('event: stasis.entered');
    expect(sseStasisChunk).toContain('BUDGET_BREACH');

    expect(governanceContext.connectionLifecycle.getSession(session.session_id)?.state).toBe(
      'suspended_stasis'
    );

    const stasisMcpRes = await created.app.request(MCP_HTTP_RESOURCE, {
      method: 'POST',
      headers: mcpHeaders('get_budget'),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'drill-stasis',
        method: 'tools/call',
        params: { name: 'get_budget', arguments: {}, _meta: mcpMeta() },
      }),
    });
    expect(stasisMcpRes.status).toBe(423);
    expect(await stasisMcpRes.json()).toMatchObject({
      error: { data: { code: 'STASIS_ACTIVE' } },
    });

    // 4. Non-platform_admin / AI cannot resume STASIS; human platform_admin resumes and SSE receives stasis.resumed
    const opResumeDenied = await created.app.request('/ops/resume', {
      method: 'POST',
      headers: { authorization: 'Bearer human-op-token', 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Non-admin resume attempt' }),
    });
    expect(opResumeDenied.status).toBe(403);

    const adminResumeOk = await created.app.request('/ops/resume', {
      method: 'POST',
      headers: { authorization: 'Bearer human-admin-token', 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Human admin cleared drill STASIS' }),
    });
    expect(adminResumeOk.status).toBe(200);

    // Drain SSE until stasis.resumed appears
    const resumedChunkText = await readSseUntil('event: stasis.resumed', 12);
    sseAbort.abort();
    await reader?.cancel();
    expect(resumedChunkText).toContain('event: stasis.resumed');

    // Closed/disconnected session stays permanently unusable fail-closed
    governanceContext.connectionLifecycle.drainAndClose(session.session_id, 'disconnect_drill');
    const closedSessionRes = await created.app.request(MCP_HTTP_RESOURCE, {
      method: 'POST',
      headers: mcpHeaders('get_budget'),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'drill-closed-sess',
        method: 'tools/call',
        params: { name: 'get_budget', arguments: {}, _meta: mcpMeta() },
      }),
    });
    expect(closedSessionRes.status).toBe(401);

    // Verify full audit integrity after all failure drills
    expect(verifyIndependentAuditChain(governanceContext.auditSink).valid).toBe(true);
  }, 20_000);
});
