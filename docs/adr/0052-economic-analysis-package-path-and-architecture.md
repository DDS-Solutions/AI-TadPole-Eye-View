# ADR 0052 — Economic analysis workspace package path and pure domain architecture

**Status:** Accepted  
**Date:** 2026-09-16  
**Deciders:** Core Engineering Team  
**Consulted:** PLAN.md §3.1, §8.2, §10 Task 8.2, AGENTS.md, ADR 0035, ADR 0039  

---

## 1. Context

In PLAN.md §1.2, §3.1, and §8.2, Phase 8 introduces the foundation for Economic Intelligence (R0–R4). The plan specifically established that the economic workspace package path remained unassigned in early documentation to prevent undeclared dependencies, phantom imports, and architectural drift prior to explicit authorization.

Economic analysis for AI-Tadpole-OS SMB digital twins requires deterministic mathematical domain algorithms, including:
- Statistical Margin of Error (MOE) combination for sums, proportions, and ratios (Census Bureau standard formulas);
- Herfindahl-Hirschman Index (HHI) market concentration scoring;
- Location Quotient (LQ) industry specialization metrics;
- Shift-Share regional employment growth decomposition;
- Structured evidence disagreement detection between model benchmarks and observations.

Under PLAN.md §2 Principle 1 (*Boundaries are law*), domain calculations must remain pure, while providers handle I/O and contracts validate boundaries. If economic analysis functions perform ad-hoc network queries, file operations, or database reads, test determinism is broken, licensing and budget governors are bypassed, and runtime reliability degrades.

---

## 2. Decision

### 2.1 Literal Package Path Reservation
This ADR formally reserves and assigns the literal workspace package path:
- **Workspace Path:** `packages/economic`
- **Package Identifier:** `@gev/economic`
- **Dependencies:** `@gev/contracts` (workspace:*), pure utility types, and devDependencies (`vitest`, `fast-check`, `typescript`).

### 2.2 Strict Zero-I/O Boundary
The `@gev/economic` package is strictly a **pure domain and calculation engine**:
1. **Zero I/O Execution:** The package must never import `node:fs`, `fs`, `node:http`, `node:https`, `fetch`, `undici`, `axios`, `sqlite`, or any persistence/network driver.
2. **Deterministic & Frozen-Clock:** All temporal calculations consume injected timestamps or `SimClock` milliseconds. Wall-clock APIs (`Date.now()`, `new Date()`) are forbidden in domain calculations.
3. **Pure Functions:** All algorithms must be pure functions of their explicit input arguments and return validated domain objects.

### 2.3 Economic Source Registry
`@gev/economic` defines an explicit, typed **Economic Source Registry** cataloging approved public data sources:
- U.S. Census Bureau: American Community Survey (ACS) 5-Year Estimates;
- U.S. Census Bureau: County Business Patterns (CBP) and ZIP Code Business Patterns (ZBP);
- U.S. Bureau of Labor Statistics (BLS): Occupational Employment and Wage Statistics (OEWS);
- U.S. Bureau of Labor Statistics (BLS): Local Area Unemployment Statistics (LAU);
- Federal Emergency Management Agency (FEMA): National Risk Index (NRI) & National Flood Hazard Layer (NFHL);
- U.S. Geological Survey (USGS): 3D Elevation Program (3DEP);
- Environmental Protection Agency (EPA): Air Quality System (AQS);
- U.S. Department of Transportation / Bureau of Transportation Statistics (DOT/BTS): Accessibility Metrics;
- OpenStreetMap Foundation (OSM): Local Commercial Amenities (sanitized via Overpass QL).

Each registry entry specifies source identity, agency, update cadence, geographic granularities, license identifiers, terms URLs, attribution notices, and suppression rules.

### 2.4 Provenance & Honest Estimation Law
All calculation results emitting economic estimates or evidence bundles must adhere to:
- **No Coercion to Zero:** Missing, suppressed, or unavailable data points retain their explicit discriminated status (`suppressed`, `unavailable`, `not_applicable`) and are never coerced to numeric zero.
- **Mandatory Provenance:** Every evidence bundle and summary estimate output attaches validated `DataProvenance` (source ID, retrieval timestamp, vintage, mode, license ID, and attribution).
- **Mandatory Legal Disclaimer:** Every exported preview carries the mandatory statutory notice:
  > *"Economic results are decision-support signals, not guarantees, appraisals, legal advice, underwriting decisions, or automated employment decisions."*

---

## 3. Consequences

### Positive
- Formal path reservation eliminates documentation drift and ensures `@gev/economic` is recognized across monorepo tooling.
- Zero-I/O constraint guarantees 100% offline, deterministic property testing without mocking network or disk layers.
- Clear separation of concerns: `packages/economic` calculates; `packages/providers` ingests; `packages/contracts` validates; `apps/server` routes and governs.

### Negative / Trade-offs
- Calling applications cannot query data directly through `@gev/economic`; they must pass validated input data into the economic functions, requiring slightly more orchestration code in handlers/tools.

---

## 4. Compliance & Verification Gate

The package must include an automated architectural compliance test that:
1. Performs static analysis on `packages/economic/src` to assert zero imports of network or filesystem modules.
2. Runs fast-check property-based tests verifying mathematical invariants (e.g. $0 \le \text{HHI} \le 10,000$, $\text{MOE} \ge 0$, $\text{LQ} \ge 0$).
3. Verifies that all emitted estimates strictly preserve suppression status without zero-coercion.
