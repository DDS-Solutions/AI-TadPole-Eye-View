import path from 'node:path';
import type { ApprovalGate, ProviderRegistry, SceneState } from '@gev/contracts';
import { GovernedToolExecutor, type SimClock, SystemClock, getDefaultSceneState } from '@gev/core';
import {
  type CapBudgetGovernor,
  type GovernanceRuntimeContext,
  type SqliteAuditSink,
  type SqliteBudgetLedger,
  createGovernanceRuntimeContext,
} from '@gev/governance';
import { OpenSkyAdapter, createConfiguredProviderRegistry } from '@gev/providers';
import { MCP_OPERATOR_TOOL_NAMES, registerOperatorToolHandlers } from './tools.js';

export const DEFAULT_SCENE_ROOT = path.join('.gev', 'scenes');

export interface OperatorContext {
  governanceContext: GovernanceRuntimeContext;
  clock: SimClock;
  auditSink: SqliteAuditSink;
  budgetGovernor: CapBudgetGovernor;
  budgetLedger: SqliteBudgetLedger;
  approvalGate: ApprovalGate;
  toolExecutor: GovernedToolExecutor;
  openSkyAdapter: OpenSkyAdapter;
  providerRegistry: ProviderRegistry;
  flags: Map<string, boolean>;
  sceneRoot: string;
  sceneState: SceneState;
}

export function createOperatorContext(customContext?: Partial<OperatorContext>): OperatorContext {
  if (
    customContext?.clock &&
    customContext.governanceContext &&
    customContext.clock !== customContext.governanceContext.clock
  ) {
    throw new Error('Operator clock must be the shared governance runtime clock');
  }
  const clock =
    customContext?.governanceContext?.clock ?? customContext?.clock ?? new SystemClock();
  const governanceContext =
    customContext?.governanceContext ??
    createGovernanceRuntimeContext({
      clock,
      auditSink: customContext?.auditSink,
      budgetGovernor: customContext?.budgetGovernor,
      budgetLedger: customContext?.budgetLedger,
      approvalGate: customContext?.approvalGate,
    });
  const toolExecutor = new GovernedToolExecutor({
    clock,
    auditSink: governanceContext.auditSink,
    budgetGovernor: governanceContext.budgetGovernor,
    budgetLedger: governanceContext.budgetLedger,
    approvalGate: governanceContext.approvalGate,
    allowedTools: MCP_OPERATOR_TOOL_NAMES,
  });
  const context: OperatorContext = {
    governanceContext,
    clock,
    auditSink: governanceContext.auditSink,
    budgetGovernor: governanceContext.budgetGovernor,
    budgetLedger: governanceContext.budgetLedger,
    approvalGate: governanceContext.approvalGate,
    toolExecutor,
    openSkyAdapter: customContext?.openSkyAdapter ?? new OpenSkyAdapter({ clock }),
    providerRegistry: customContext?.providerRegistry ?? createConfiguredProviderRegistry(),
    flags: customContext?.flags ?? new Map<string, boolean>([['opensky.enabled', true]]),
    sceneRoot: path.resolve(
      customContext?.sceneRoot ?? process.env.GEV_MCP_SCENE_ROOT ?? DEFAULT_SCENE_ROOT
    ),
    sceneState: customContext?.sceneState ?? getDefaultSceneState(clock),
  };
  registerOperatorToolHandlers(context);
  return context;
}
