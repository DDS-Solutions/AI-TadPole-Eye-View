# ADR 0039 — Language placement and runtime boundaries

**Status:** Accepted
**Date:** 2026-08-27

## Context

GEV is a browser-first Cesium product with a Svelte UI and a TypeScript monorepo.
Its contracts, providers, Hono server, operator tools, and CLI benefit from shared
types and one governance pipeline. AI-Tadpole-OS uses Rust, and some future GEV
work may need stronger process isolation, predictable resource use, or CPU-heavy
processing. Economic source research may also benefit from Python tooling.

Using every language throughout the product would duplicate contracts, build
systems, deployment paths, observability, and security review. Conversely, banning
specialized languages would discard Rust's high-assurance strengths and Python's
offline data ecosystem.

## Decision

**TypeScript/Svelte for the product surface and orchestration; Rust for narrowly
defined high-assurance or performance-critical services; SQL for persistence;
Python only for offline research and data preparation.**

1. TypeScript is the default for the Svelte UI, Cesium integration, Zod contracts,
   provider adapters, Hono server, MCP/CLI orchestration, and deterministic economic logic.
2. Rust is introduced only behind a versioned contract after measurements or a
   security/reliability requirement justifies a separate service, library, or WASM
   module. Tadpole remains behind the five governance ports. No wholesale rewrite
   is authorized by this ADR.
3. SQL defines durable storage semantics through reviewed schemas, migrations,
   transactions, tenant controls, and repository interfaces. SQLite remains the
   local baseline; production storage requires a deployment ADR.
4. Python is limited to offline research, fixture preparation, exploration, and
   independent validation. It is not a production request path or second domain
   implementation. Outputs entering the repository must be reproducible, versioned,
   licensed, and validated by canonical contracts.
5. React is not part of the current UI architecture. Tailwind is a CSS framework,
   not a language, and is not installed; DESIGN.md remains authoritative.

## Admission gate for another language or runtime

A proposal must include measured need, ownership, versioned contracts, deterministic
tests, build/deployment/rollback design, observability, security and licensing review,
and the cost of keeping implementations synchronized. Without that evidence, use the
existing TypeScript boundary.

## Consequences

- Most product work retains one fast, type-shared development loop.
- High-assurance or CPU-intensive work can use Rust without forcing a full rewrite.
- Python remains useful without becoming an unaudited production dependency.
- Cross-language components carry an explicit maintenance and conformance burden.
