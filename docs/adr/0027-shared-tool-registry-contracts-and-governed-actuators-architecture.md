# ADR 0027: Shared Tool Registry Contracts & Governed Actuators Architecture

## Status
Accepted

## Date
2026-08-26

## Context
In [PLAN.md](../../PLAN.md) (§3.2, §6, §7.2), a single shared tool definition surface must serve three distinct consumers:
1. The Tactical Voice Agent (OpenAI Realtime function definitions / OpenRouter schemas).
2. The In-App AI Co-User (Tadpole digital twin / web co-pilot).
3. The Operator MCP Server (`@gev/ops-mcp`).

Every tool invocation must enforce:
- Input schema validation via Zod.
- Pre-execution `audit.intent` logging to `AuditSink` (PLAN.md §2 rule 1).
- STASIS and BudgetGovernor validation.
- ApprovalGate checks on dangerous or mutating operations.
- Post-execution `audit.outcome` logging.

## Decision
1. **Contract-Driven Tool Registry:**
   All operator and console domain tools (`fly_to_location`, `toggle_layer`, `select_entity`, `inspect_telemetry`, `query_aoi`, `set_sim_time`, `get_feed_health`, `get_budget`, `run_diagnostics`, `load_scene`, `save_scene`, `tail_logs`, `set_flag`) are declared in `@gev/contracts` in `OPERATOR_TOOLS` with Zod input/output schemas and metadata flags (`is_mutating`, `is_dangerous`, `is_cacheable`).
2. **Schema Generators:**
   `getOpenAIToolDefinitions()` and `getMcpToolDefinitions()` generate OpenAI Realtime function declarations and MCP tools automatically from the single source of truth.
3. **GovernedToolExecutor:**
   Implemented in `@gev/core`, the `GovernedToolExecutor` is the only tool lifecycle.
   Contract membership, consumer capability, input, required ports, and handler presence
   are preflight checks that fail before action and therefore emit no orphan outcome.
   A valid invocation then follows one strict order: durable `audit.intent` → durable
   governance check → dangerous-tool approval → one handler dispatch → output validation
   → exactly one `audit.outcome` attempt. Every consumer receives the same normalized
   success, blocked, or error result. Mutating tools are blocked during STASIS; status,
   diagnostics, and audit reads validate durable state but remain available for observability.
4. **Consumer and transport wiring:**
   Each consumer composes the executor with the shared runtime ports and an explicit
   capability set. Local stdio MCP registers and advertises exactly seven tools and derives
   input/output schemas from the registry. Browser-local handlers cannot execute without
   shared governance ports and never claim process-local state as shared authority.

## Consequences
- Single point of maintenance for all operator actuators.
- Guaranteed audit trail across voice agent, co-user, and remote MCP interactions.
- Prevents rogue mutations during STASIS lock.
- Invalid or unsupported calls fail before handler dispatch and cannot create orphan outcomes.
