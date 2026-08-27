# ADR 0030 — V3 canonical plan and deterministic resume checkpoint

**Status:** Accepted
**Date:** 2026-08-27

## Context

The repository's former PLAN.md marked broad Phase 0–4 claims complete even though
the comparison audit found hardcoded status/health, incomplete satellite and cable
layers, ineffective documentation checks, an unprotected operations route ordering
defect, and non-green lint/Playwright gates. A separate V2 economic plan also
contained newer product scope but contradicted the repository and current external
specifications. A new chat could therefore resume from the wrong phase or source.

## Decision

`PLAN.md` remains the repository's legal source of truth required by AGENTS.md.
`MASTER_PLAN_V3.md` is an exact named copy kept in the same workspace for explicit
discovery and preservation of the V3 name. The files must remain byte-identical.

PLAN.md §0 contains a machine-readable `CURRENT_PHASE`, `NEXT_TASK`, task status,
verification date, and governance-observability caveat. `NEXT_TASK` must equal the
first unchecked task in §10. Completion requires exit evidence in §17 before either
the checkbox or checkpoint advances.

Every session verifies the two plan copies before implementation. A difference is a
`DOC_BLOCKER`. The first implementation task strengthens ADG so CI also checks the
copy invariant and detects false symbol/path/status/version claims.

The external file `D:\AI-TadPole-Eye-View-Master Plan V2` is preserved as historical
input and is not a resume source.

This ADR also grants a narrow exception to the repository's 500-line rule for
`PLAN.md` and its exact named copy. Keeping the resume protocol, phased tracker,
decision dependencies, and evidence log atomic is safer than splitting the legal
plan across includes that Markdown, ADG, or a new agent may not load consistently.
The exception does not apply to implementation files or other documentation.

## Consequences

- A new agent has one deterministic next task and a ready 4-Pillar brief.
- Historical Phase 0–4 checkmarks are no longer treated as certification without evidence.
- Plan edits touch two files until a future ADR deliberately replaces the mirror strategy.
- `PLAN.md` wins semantically, but any mismatch blocks work rather than authorizing silent repair or guesswork.
