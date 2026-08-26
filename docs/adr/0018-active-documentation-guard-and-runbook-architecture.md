# ADR 0018: Active Documentation Guard (ADG) & Operational Runbook Architecture

## Status
Accepted (2026-08-26)

## Context
PLAN.md §2 Law 7 mandates that documentation must not drift from active source code:
> "Active Documentation Guard (ADG) — CI gate failing when docs reference symbols/paths that don't exist."

In large-scale AI agent development, agents frequently hallucinate non-existent files, obsolete function exports, or dead paths. Without an automated guard rail, documentation rot accumulates rapidly. Additionally, human operators and AI agents require deterministic operational procedures (`RUNBOOK.md`) for STASIS lockdown, emergency resumption, telemetry circuit breaking, and ethical boundaries.

## Decision
1. **Active Documentation Guard (`scripts/adg.mjs`)**:
   - Implemented an automated validator executed via `pnpm docs:check` in CI.
   - Recursively parses all repository documentation (`PLAN.md`, `AGENTS.md`, `RUNBOOK.md`, `docs/**/*.md`).
   - Validates all markdown link targets and backticked workspace paths (`packages/...`, `apps/...`, `scripts/...`, `fixtures/...`, `docs/...`) against actual filesystem paths.
   - Extracts all exported symbols across packages (`export class/function/type/const/enum`) to guard against dead symbol references.
   - Executes deterministically in sub-50ms (well under the 2-second SLA).
2. **Standardized Operational Runbooks (`RUNBOOK.md`)**:
   - Standardized the human-only STASIS recovery protocol (`gev status` -> `gev audit tail` -> `gev resume`).
   - Defined seed mode vs live mode toggles (`GEV_SEED_MODE=1` default).
   - Codified PLAN.md §12 ethics emergency stop protocol (person-tracking / ALPR / biometrics immediate abort).

## Consequences
- **Positive**: Zero dead links or phantom file references allowed into `main`; CI gate enforces 100% active alignment between documentation and codebase; operational procedures are strictly codified.
- **Trade-off**: Documentation updates must match active file names and exports.
