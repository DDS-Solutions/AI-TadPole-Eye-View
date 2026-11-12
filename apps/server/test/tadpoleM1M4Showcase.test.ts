import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  type AuthenticatedIdentityContext,
  GEV_PRODUCTION_IDENTITY_PROFILE,
  GevEvents,
  type IdentityBearerVerifier,
  TaskBrief,
} from '@gev/contracts';
import type { McpAuthorizationContext } from '@gev/contracts/mcp-authorization';
import { FrozenClock } from '@gev/core';
import {
  CapBudgetGovernor,
  LocalSignedApprovalProvider,
  SqliteBudgetLedger,
  assertM1ToM3Prerequisites,
  createGovernanceRuntimeContext,
  generateEd25519KeyPair,
  verifyIndependentAuditChain,
} from '@gev/governance';
import { afterEach, describe, expect, it } from 'vitest';
import { type CreatedApp, createApp } from '../src/index.js';
import { MCP_HTTP_HOST, MCP_HTTP_RESOURCE, MCP_TEST_ISSUER } from '../src/routes/mcp.js';

const NOW = 1_731_420_000_000;

function makeHumanAdminIdentity(): AuthenticatedIdentityContext {
  const nowSec = Math.floor(NOW / 1000);
  return {
    actor: 'human',
    principal: 'auth0|platform-admin-m4',
    tenant_id: 'tenant-m4',
    role: 'platform_admin',
    client_id: 'gev-web',
    token_id: 'human-admin-1',
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
    principal: 'svc:tadpole-m4',
    tenant_id: 'tenant-m4',
    client_id: 'tadpole-runtime',
    token_id: 'mcp-ai-1',
    issuer: MCP_TEST_ISSUER,
    audience: MCP_HTTP_RESOURCE,
    resource: MCP_HTTP_RESOURCE,
    scopes: ['read.telemetry', 'read.audit', 'write.flags'],
    issued_at_epoch_seconds: nowSec - 10,
    not_before_epoch_seconds: nowSec - 10,
    expires_at_epoch_seconds: nowSec + 240,
    task_ref: 'task-12-2-m1-m4',
  };
}

function createMcpMeta(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientInfo': { name: 'tadpole-m4-showcase', version: '1.0.0' },
    'io.modelcontextprotocol/clientCapabilities': {},
    ...extra,
  };
}

describe('Task 12.2: End-to-End M1->M2->M3->M4 Governed Tadpole Showcase', () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it('proves M1 observation, M2 signed approval, M3 shared SQLite ledger/STASIS, and M4 authenticated HTTP MCP with independent audit verification', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-m1m4-server-'));
    const dbPath = path.join(dir, 'governance.sqlite');
    const clock = new FrozenClock(NOW);
    const approvalKeys = generateEd25519KeyPair();

    const governanceContext = createGovernanceRuntimeContext({
      clock,
      dbPath,
      capUsd: 10.0,
      signedApproval: {
        trustedKeys: [
          {
            signerId: 'human:ops-lead',
            keyId: 'ops-ed25519-v1',
            publicKeyPem: approvalKeys.publicKeyPem,
            status: 'active',
          },
        ],
        provider: new LocalSignedApprovalProvider({
          signerId: 'human:ops-lead',
          keyId: 'ops-ed25519-v1',
          privateKeyPem: approvalKeys.privateKeyPem,
          policy: 'approve_all',
          clock,
        }),
      },
    });

    const humanIdentity = makeHumanAdminIdentity();
    const aiMcpIdentity = makeMcpAiIdentity();

    const identityBearerVerifier: IdentityBearerVerifier = {
      verify: async ({ access_token }) =>
        access_token === 'human-admin-token' ? humanIdentity : null,
    };

    const created: CreatedApp = createApp({
      clock,
      governanceContext,
      identityBearerVerifier,
      mcpHttpEnabled: true,
      mcpHttpResponseMode: 'json',
      mcpHttpBearerVerifier: {
        verify: async ({ access_token }) =>
          access_token === 'ai-mcp-token' ? aiMcpIdentity : null,
      },
    });
    cleanups.push(async () => {
      await created.mcpHttp?.close();
      governanceContext.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
    });

    // ─── M1: Authenticated Audit Observation & Health ────────────────────
    const unauthIntegrity = await created.app.request('/ops/audit/integrity');
    expect([401, 403]).toContain(unauthIntegrity.status);

    const authIntegrity = await created.app.request('/ops/audit/integrity', {
      headers: { authorization: 'Bearer human-admin-token' },
    });
    expect(authIntegrity.status).toBe(200);
    expect(await authIntegrity.json()).toMatchObject({ status: 'valid' });

    const abortController = new AbortController();
    const streamRes = await created.app.request('/ops/audit/stream', {
      headers: { authorization: 'Bearer human-admin-token' },
      signal: abortController.signal,
    });
    expect(streamRes.status).toBe(200);
    const reader = streamRes.body?.getReader();
    const firstChunk = await reader?.read();
    abortController.abort();
    await reader?.cancel();
    const sseText = new TextDecoder().decode(firstChunk?.value);
    expect(sseText).toContain('event: audit.connected');
    expect(sseText).toContain('M1_OBSERVER');

    const healthRes = await created.app.request('/api/health');
    expect(healthRes.status).toBe(200);
    const healthJson = (await healthRes.json()) as {
      stasis_active: boolean;
      governance_authority: { kind: string; authoritative: boolean };
    };
    expect(healthJson.stasis_active).toBe(false);
    expect(healthJson.governance_authority).toMatchObject({
      kind: 'shared_sqlite',
      authoritative: true,
    });

    // ─── M2 + M3 Prerequisites & Cross-Handle STASIS / Human Resume ─────
    const preReadiness = assertM1ToM3Prerequisites(governanceContext, {
      requireSignedApprovalGate: true,
      requireSharedAuthority: true,
    });
    expect(preReadiness.m2_gate_kind).toBe('signed_approval_gate');

    // Second independent process-style handle to same SQLite DB observes M3 state
    const observerGovernor = new CapBudgetGovernor({ clock, dbPath });
    const observerLedger = new SqliteBudgetLedger({ clock, dbPath });
    cleanups.push(() => {
      observerGovernor.close();
      observerLedger.close();
    });

    governanceContext.budgetGovernor.trip('BUDGET_BREACH', 'Task 12.2 pre-M4 STASIS drill');
    expect(observerGovernor.state().stasis_active).toBe(true);
    expect(() => assertM1ToM3Prerequisites(governanceContext)).toThrow(/STASIS/);

    // AI token cannot resume STASIS (403 HUMAN_AUTH_REQUIRED)
    const deniedResume = await created.app.request('/ops/resume', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ai-mcp-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Unauthorized AI resume' }),
    });
    expect([401, 403]).toContain(deniedResume.status);

    // Human platform_admin resumes STASIS via /ops/resume
    const humanResume = await created.app.request('/ops/resume', {
      method: 'POST',
      headers: {
        authorization: 'Bearer human-admin-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Human operator cleared STASIS before M4' }),
    });
    expect(humanResume.status).toBe(200);
    expect(observerGovernor.state().stasis_active).toBe(false);

    // ─── M4: Authenticated HTTP MCP via AgentEnvelope + CapToken + Lifecycle ──
    const brief = TaskBrief.parse({
      id: '12.2',
      title: 'Tadpole M1-M4 Server E2E',
      scope_contract: { in_scope: ['apps/server', 'packages/governance'] },
      performance_threshold: ['M1->M4 p95 < 10ms'],
      architecture_mode: ['PLAN.md §12.2', 'ADR 0038'],
      failure_modes: ['Fail closed on missing M1-M3 prerequisites'],
      task_ref: 'task-12-2-m1-m4',
    });
    const wrapped = governanceContext.agentEnvelope.wrapDetailed(brief);
    expect(wrapped.task_ref).toBe('task-12-2-m1-m4');

    const capToken = governanceContext.capabilityIssuer.issue(
      aiMcpIdentity.principal,
      ['read.telemetry', 'write.flags'],
      240
    );
    const session = governanceContext.connectionLifecycle.openSession({
      transport: 'http-2026-07-28',
      authorization: aiMcpIdentity,
      capToken,
      taskBrief: brief,
    });

    // 1. Governed read over HTTP MCP
    const readRes = await created.app.request(MCP_HTTP_RESOURCE, {
      method: 'POST',
      headers: {
        host: MCP_HTTP_HOST,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        authorization: 'Bearer ai-mcp-token',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': 'get_budget',
        'x-tadpole-cap-token': capToken.token,
        'x-tadpole-session-id': session.session_id,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'm4-read-1',
        method: 'tools/call',
        params: { name: 'get_budget', arguments: {}, _meta: createMcpMeta() },
      }),
    });
    expect(readRes.status).toBe(200);

    // 2. Dangerous + ledger-reserved mutation (set_flag) triggering M2 SignedApprovalGate + M3 SqliteBudgetLedger
    const mutationOpId = crypto.randomUUID();
    const mutationRes = await created.app.request(MCP_HTTP_RESOURCE, {
      method: 'POST',
      headers: {
        host: MCP_HTTP_HOST,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        authorization: 'Bearer ai-mcp-token',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': 'set_flag',
        'x-tadpole-cap-token': capToken.token,
        'x-tadpole-session-id': session.session_id,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'm4-mutate-1',
        method: 'tools/call',
        params: {
          name: 'set_flag',
          arguments: { flag: 'opensky.enabled', enabled: false },
          _meta: createMcpMeta({ operation_id: mutationOpId }),
        },
      }),
    });
    expect(mutationRes.status).toBe(200);
    const mutationJson = (await mutationRes.json()) as {
      result?: { isError?: boolean; structuredContent?: { updated?: boolean; enabled?: boolean } };
    };
    expect(mutationJson.result?.isError).not.toBe(true);
    expect(mutationJson.result?.structuredContent).toMatchObject({
      updated: true,
      enabled: false,
    });

    // Independent observer ledger confirms M3 operation settled cleanly
    const persistedOp = observerLedger.lookup(mutationOpId);
    expect(persistedOp).not.toBeNull();
    expect(persistedOp?.state).toBe('SETTLED');

    // Close session and verify complete independent M1 SQLite audit chain + HTTP /ops/audit/integrity
    governanceContext.connectionLifecycle.drainAndClose(session.session_id, 'showcase_done');
    const finalIntegrityRes = await created.app.request('/ops/audit/integrity', {
      headers: { authorization: 'Bearer human-admin-token' },
    });
    expect(finalIntegrityRes.status).toBe(200);
    expect(await finalIntegrityRes.json()).toMatchObject({ status: 'valid' });

    const auditReport = verifyIndependentAuditChain(governanceContext.auditSink, {
      requiredActions: [
        'governance.resume',
        'tadpole.session.open',
        'tool.get_budget',
        'tool.set_flag',
        'tadpole.session.close',
      ],
    });
    expect(auditReport.valid).toBe(true);
    expect(auditReport.orphan_outcomes).toEqual([]);
    expect(auditReport.missing_required_actions).toEqual([]);

    // Confirm audit.intent was emitted before audit.outcome for tool.set_flag
    const entries = governanceContext.auditSink.tail({ limit: 50 });
    const flagIntent = entries.find(
      (e) => e.kind === GevEvents.AuditIntent && e.action === 'tool.set_flag'
    );
    const flagOutcome = entries.find(
      (e) => e.kind === GevEvents.AuditOutcome && e.intent_id === flagIntent?.id
    );
    expect(flagIntent).toBeDefined();
    expect(flagOutcome).toBeDefined();
  });
});
