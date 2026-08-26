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
   Implemented in `@gev/core`, the `GovernedToolExecutor` encapsulates the full 6-step lifecycle: schema validation → STASIS & budget check → pre-execution `audit.intent` → approval gate check → execution → post-execution `audit.outcome`.

## Consequences
- Single point of maintenance for all operator actuators.
- Guaranteed audit trail across voice agent, co-user, and remote MCP interactions.
- Prevents rogue mutations during STASIS lock.
