# ADR 0049: Registry-derived Layer Access read model

- **Status:** Accepted
- **Date:** 2026-09-06
- **Task:** PLAN.md 5.3.5
- **Extends:** [ADR 0035](./0035-provenance-contract-and-freshness-policy.md),
  [ADR 0045](./0045-operational-awareness-source-and-access-policy.md),
  [ADR 0048](./0048-bounded-operational-imagery-spike.md)

## Context

Provider, feed, and layer identity already comes from the typed provider registry, but the web HUD
has no single read model for the independent implementation, credential, terms, configuration,
policy, runtime, and effective-access states in PLAN.md §4.5. The existing satellite row learns one
combined lock reason from its data request. That is insufficient for all-source discovery and must
not become a second provider catalog or a browser-side interpretation of environment variables.

Phase 7 owns tenant identity and mutating credential/terms administration. Task 5.3.5 therefore
needs a read-only boundary which exposes useful static requirements and, only when an approved
authenticated local authority supplies it, non-reversible masked status. Unknown local state must
remain unknown instead of being guessed as missing or invalid.

## Decision

- `ProviderRegistryProvider.source_access` is required registry metadata. It contains the domain,
  selected products, credential requirement, terms owner/link, configuration requirement,
  operating bounds, kill-switch ownership, and concise non-secret setup instructions. This is
  additive to registry version 2 because existing identity and mode semantics do not change.
- `LayerAccessReadModel` is a separate version-1 contract. One pure provider projection combines a
  typed registry snapshot with a bounded, SimClock-timestamped runtime/read-authority snapshot.
  The projection derives stable ordering, counts, effective state, and lock reasons without
  provider-name branching.
- Required local credential, terms, or configuration state is nullable behind an explicit
  `available`/`unavailable` authority status. A masked credential fingerprint is accepted only in
  the fixed bullet-mask format; raw secret values have no contract field.
- `GET /ops/layer-access` stays under the existing operations authentication middleware. Every read
  writes an audit intent and outcome, returns `Cache-Control: no-store`, caps the serialized result
  at 2 MiB, and performs no provider request. Tokenless local seed may read the non-secret catalog,
  but receives an explicit unavailable local-status reason. Authenticated masked status is exposed
  only when the server composition supplies an approved local status authority.
- Settings → Layer Access consumes only this validated response. It groups and searches all
  registered entries, shows the independent gates and source-time distinctions, and links to
  registry-authored setup, terms, attribution, and source documentation. Credential and terms
  writes remain absent. The existing locked satellite row opens its exact `celestrak` entry and
  focus returns to the invoking control on close.
- Static projection scaffolding is cached by immutable registry object identity. Runtime and
  authority fields are still recomputed for every snapshot. This keeps a 2,000-entry projection
  and filter recomputation below the 16.6 ms p95 budget without stale cross-registry state.

## Consequences

- Planned, incomplete, locked, disabled, stale, and unavailable sources remain discoverable without
  becoming active or increasing registry counts.
- Seed/test/CI and the shipped panel open zero provider sockets. A stale successful provider
  response remains a runtime freshness state and is not treated as healthy merely because HTTP
  succeeded.
- The current server has no credential store or terms-record read authority, so production status
  remains fail-closed and visibly unavailable. Phase 7 may supply a tenant-scoped authority through
  the same input contract; it must not add browser secret access or a parallel gate evaluator.
- Registry documentation now includes the static Layer Access domain and requirement fields.
