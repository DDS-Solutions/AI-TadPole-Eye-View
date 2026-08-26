# ADR 0016: Built-in node:sqlite for Local Governance AuditSink Write-Ahead Log (WAL)

**Status:** Accepted · **Date:** 2026-08-26 · **Deciders:** Architecture Review

---

## Context & Problem Statement

PLAN.md Rule 1 and §6 mandate an immutable, tamper-evident audit trail for all mutating actions (`audit.intent` logged before execution, `audit.outcome` logged after). Traditional Node.js SQLite libraries (such as `better-sqlite3` or `sqlite3`) require native binary compilation steps via `node-gyp`. Native compilation introduces platform incompatibilities across diverse developer/CI operating systems and requires expanding `onlyBuiltDependencies` in `pnpm-workspace.yaml`.

Node.js 22.5+ and Node.js 24 ship with built-in SQLite support via the `node:sqlite` module.

## Decision

1. **Zero Native Build Dependencies:** Standardize the local Phase-0 `AuditSink` implementation on the built-in `node:sqlite` module (`DatabaseSync`).
2. **Accept Node 24 Experimental Warning:** Node 24 prints an informational experimental warning when loading `node:sqlite`. This is acceptable and blessed for local Phase-0 governance stubs prior to Tadpole M1 integration.
3. **WAL Mode:** Initialize SQLite with Write-Ahead Logging (`PRAGMA journal_mode = WAL;`) and `PRAGMA synchronous = NORMAL;` to guarantee durability and high throughput without blocking reads.

## Consequences

- **Positive:** Zero external native compile steps; CI and local install speeds remain instant.
- **Positive:** Standalone, dependency-free local governance audit sink.
- **Negative:** Experimental flag on Node runtime (transitional until Node stabilizes the API).
