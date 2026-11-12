import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GevEvents, type GovernanceAuthority, TaskBrief } from '@gev/contracts';
import type { McpAuthorizationContext } from '@gev/contracts/mcp-authorization';
import { FrozenClock } from '@gev/core';
import {
  LocalSignedApprovalProvider,
  type M2GateKind,
  assertM1ToM3Prerequisites,
  createGovernanceRuntimeContext,
  generateEd25519KeyPair,
  verifyIndependentAuditChain,
} from '@gev/governance';
import { createOperatorContext } from '@gev/ops-mcp';
import { createGevMcpHttpHandler, toGevMcpAuthInfo } from '@gev/ops-mcp/http';
import pc from 'picocolors';

export interface M1M4ShowcaseOptions {
  dbPath?: string;
  json?: boolean;
}

export interface M1M4ShowcaseResult {
  success: boolean;
  authority_kind: GovernanceAuthority['kind'];
  m1_verified_entries: number;
  m2_gate_kind: M2GateKind;
  m3_stasis_recovered: boolean;
  m3_operation_state: string;
  m4_session_id: string;
  m4_read_status: number;
  m4_mutation_status: number;
  audit_valid: boolean;
}

const SHOWCASE_RESOURCE = 'http://127.0.0.1:3000/mcp';
const SHOWCASE_ISSUER = 'https://auth.gev.local/';

/**
 * Demonstrates M1 observation, M2 signed approval verification, M3 shared SQLite
 * ledger & STASIS resume, M4 authenticated MCP execution (AgentEnvelope + CapToken),
 * and independent SQLite audit chain verification end-to-end.
 */
export async function runM1M4Showcase(
  options: M1M4ShowcaseOptions = {}
): Promise<M1M4ShowcaseResult> {
  const tempDir = options.dbPath
    ? undefined
    : fs.mkdtempSync(path.join(os.tmpdir(), 'gev-m1m4-showcase-'));
  const dbPath = options.dbPath ?? path.join(tempDir ?? os.tmpdir(), 'governance.sqlite');
  const clock = new FrozenClock(1_731_420_000_000);
  const approvalKeys = generateEd25519KeyPair();

  const runtimeContext = createGovernanceRuntimeContext({
    clock,
    dbPath,
    capUsd: 5.0,
    signedApproval: {
      trustedKeys: [
        {
          signerId: 'human:showcase-operator',
          keyId: 'showcase-ed25519-v1',
          publicKeyPem: approvalKeys.publicKeyPem,
          status: 'active',
        },
      ],
      provider: new LocalSignedApprovalProvider({
        signerId: 'human:showcase-operator',
        keyId: 'showcase-ed25519-v1',
        privateKeyPem: approvalKeys.privateKeyPem,
        policy: 'approve_all',
        clock,
      }),
    },
  });

  try {
    // M1–M3 readiness check before M4
    const initialReadiness = assertM1ToM3Prerequisites(runtimeContext, {
      requireSignedApprovalGate: true,
      requireSharedAuthority: true,
    });

    // M3 STASIS trip + human-only resume demonstration
    runtimeContext.budgetGovernor.trip('BUDGET_BREACH', 'Showcase M3 STASIS verification');
    const resumeIntentId = crypto.randomUUID();
    runtimeContext.auditSink.intent({
      kind: GevEvents.AuditIntent,
      id: resumeIntentId,
      ts: clock.iso(),
      actor: 'human',
      action: 'governance.resume',
      target: 'stasis.lock',
      params: { reason: 'Human operator verified M3 ledger state prior to M4 launch' },
      task_ref: 'task-12-2-showcase',
    });
    runtimeContext.budgetGovernor.resume('human');
    runtimeContext.auditSink.outcome({
      kind: GevEvents.AuditOutcome,
      intent_id: resumeIntentId,
      ts: clock.iso(),
      status: 'ok',
      result: { resumed: true },
    });

    assertM1ToM3Prerequisites(runtimeContext, {
      requireSignedApprovalGate: true,
      requireSharedAuthority: true,
    });

    // M4 AgentEnvelope + CapToken + TadpoleConnectionLifecycle
    const brief = TaskBrief.parse({
      id: '12.2',
      title: 'Tadpole M1-M4 Governed Execution',
      scope_contract: { in_scope: ['packages/governance', 'packages/ops-mcp', 'apps/server'] },
      performance_threshold: ['End-to-end M1->M4 p95 < 10ms'],
      architecture_mode: ['PLAN.md §6, §12.2', 'ADR 0038'],
      failure_modes: ['Never skip M1-M3 prerequisites before M4'],
      task_ref: 'task-12-2-showcase',
    });
    const wrappedBrief = runtimeContext.agentEnvelope.wrapDetailed(brief);
    const nowSec = Math.floor(clock.now() / 1000);
    const baseAuth: McpAuthorizationContext = {
      actor: 'ai',
      role: 'ai_copilot',
      principal: 'svc:tadpole-m4',
      tenant_id: 'tenant-showcase',
      client_id: 'tadpole-runtime',
      token_id: 'showcase-jwt-1',
      issuer: SHOWCASE_ISSUER,
      audience: SHOWCASE_RESOURCE,
      resource: SHOWCASE_RESOURCE,
      scopes: ['read.telemetry', 'write.flags'],
      issued_at_epoch_seconds: nowSec - 5,
      not_before_epoch_seconds: nowSec - 5,
      expires_at_epoch_seconds: nowSec + 240,
      task_ref: wrappedBrief.task_ref,
    };

    const capToken = runtimeContext.capabilityIssuer.issue(
      baseAuth.principal,
      ['read.telemetry', 'write.flags'],
      240
    );
    const session = runtimeContext.connectionLifecycle.openSession({
      transport: 'http-2026-07-28',
      authorization: baseAuth,
      capToken,
      taskBrief: brief,
    });

    const propagated = runtimeContext.connectionLifecycle.propagateCapabilities(
      session.session_id,
      capToken,
      ['read.telemetry', 'write.flags']
    );

    const effectiveAuth: McpAuthorizationContext = {
      ...baseAuth,
      scopes: propagated.effectiveScopes as [
        (typeof propagated.effectiveScopes)[0],
        ...(typeof propagated.effectiveScopes)[number][],
      ],
    };

    const opContext = createOperatorContext({
      clock,
      governanceContext: runtimeContext,
    });
    const mcpHandler = createGevMcpHttpHandler({ context: opContext, responseMode: 'json' });
    const mcpMeta = {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientInfo': { name: 'tadpole-m4-showcase', version: '0.1.0' },
      'io.modelcontextprotocol/clientCapabilities': {},
    };

    try {
      const readRes = await mcpHandler.fetch(
        new Request(SHOWCASE_RESOURCE, {
          method: 'POST',
          headers: {
            accept: 'application/json, text/event-stream',
            'content-type': 'application/json',
            'mcp-protocol-version': '2026-07-28',
            'mcp-method': 'tools/call',
            'mcp-name': 'get_budget',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'm4-read-1',
            method: 'tools/call',
            params: { name: 'get_budget', arguments: {}, _meta: mcpMeta },
          }),
        }),
        { authInfo: toGevMcpAuthInfo('showcase-bearer', effectiveAuth) }
      );

      const mutationOpId = crypto.randomUUID();
      const mutationRes = await mcpHandler.fetch(
        new Request(SHOWCASE_RESOURCE, {
          method: 'POST',
          headers: {
            accept: 'application/json, text/event-stream',
            'content-type': 'application/json',
            'mcp-protocol-version': '2026-07-28',
            'mcp-method': 'tools/call',
            'mcp-name': 'set_flag',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'm4-mutate-1',
            method: 'tools/call',
            params: {
              name: 'set_flag',
              arguments: { flag: 'opensky.enabled', enabled: false },
              _meta: { ...mcpMeta, operation_id: mutationOpId },
            },
          }),
        }),
        { authInfo: toGevMcpAuthInfo('showcase-bearer', effectiveAuth) }
      );

      runtimeContext.connectionLifecycle.drainAndClose(session.session_id, 'showcase_complete');

      const ledgerOp = runtimeContext.budgetLedger.lookup(mutationOpId);
      const independentAudit = verifyIndependentAuditChain(runtimeContext.auditSink, {
        requiredActions: [
          'governance.resume',
          'tadpole.session.open',
          'tool.get_budget',
          'tool.set_flag',
          'tadpole.session.close',
        ],
      });

      const result: M1M4ShowcaseResult = {
        success:
          readRes.status === 200 &&
          mutationRes.status === 200 &&
          ledgerOp?.state === 'SETTLED' &&
          independentAudit.valid,
        authority_kind: initialReadiness.m3_authority.kind,
        m1_verified_entries: independentAudit.verified_entries,
        m2_gate_kind: initialReadiness.m2_gate_kind,
        m3_stasis_recovered: !runtimeContext.budgetGovernor.state().stasis_active,
        m3_operation_state: ledgerOp?.state ?? 'MISSING',
        m4_session_id: session.session_id,
        m4_read_status: readRes.status,
        m4_mutation_status: mutationRes.status,
        audit_valid: independentAudit.valid,
      };

      if (options.json) {
        console.log(JSON.stringify(result));
      } else {
        console.log(pc.bold(pc.cyan('\nGEV v2 M1 -> M2 -> M3 -> M4 Integration Showcase')));
        console.log(
          `  M1 Audit Integrity:  ${result.audit_valid ? pc.green('VALID') : pc.red('INVALID')} (${result.m1_verified_entries} entries)`
        );
        console.log(`  M2 Approval Gate:    ${result.m2_gate_kind}`);
        console.log(
          `  M3 Shared Ledger:    ${result.authority_kind} / operation=${result.m3_operation_state} / stasis_recovered=${result.m3_stasis_recovered}`
        );
        console.log(
          `  M4 HTTP MCP:         session=${result.m4_session_id} read=${result.m4_read_status} mutation=${result.m4_mutation_status}`
        );
      }
      return result;
    } finally {
      await mcpHandler.close();
    }
  } finally {
    runtimeContext.close();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
    }
  }
}
