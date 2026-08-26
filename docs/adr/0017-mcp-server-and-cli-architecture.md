# ADR 0017: Operator MCP Server & Unified `gev` CLI Surface

## Status
Accepted (2026-08-26)

## Context
PLAN.md §7.2 and AGENTS.md §3 require a standardized operator interface for both AI agent tool calling and human terminal inspection:
1. An MCP (Model Context Protocol) server exposing standard operator tools (`get_feed_health`, `get_budget`, `run_diagnostics`, `load_scene`, `save_scene`, `tail_logs`, `set_flag`).
2. A unified CLI command surface (`gev status`, `gev feeds health`, `gev audit tail`, `gev scene load`, `gev resume`).

AI agents need programmatic tool calling with governance manifests (`is_mutating`, `is_dangerous`, `is_cacheable`) and audit logging, while developers need sub-100ms status readouts that degrade gracefully when the backend server is offline.

## Decision
1. **Separated Packages**:
   - `packages/contracts/src/tools.ts`: Defines Zod schemas, manifests, and flags (`OPERATOR_TOOLS`).
   - `packages/ops-mcp`: Implements standard JSON-RPC 2.0 stdio transport. Strict stdout hygiene is enforced: all diagnostics write to `stderr` to avoid JSON-RPC stream corruption.
   - `packages/cli`: Implements the `gev` CLI with Commander, including robust offline fallbacks for `gev status` by querying local `CapBudgetGovernor` and `OpenSkyAdapter` when the HTTP server is unreachable.
2. **Rule 1 Enforcement in MCP**:
   - Mutating MCP tool calls (`set_flag`, `load_scene`, `save_scene`) write `audit.intent` before execution and `audit.outcome` after execution to the `SqliteAuditSink`.
3. **Human-Only Resume**:
   - `gev resume` provides the explicit human override path required by PLAN.md §0 / AGENTS.md §9 to lift STASIS locks and write `stasis.resumed` to the WAL.

## Consequences
- **Positive**: Single typed contract for operator tools; agents and developers share identical health/governance vocabulary; CLI executes instantly (<100ms) with zero crashes when offline.
- **Trade-off**: Requires stdio stream isolation testing in unit test suites.
