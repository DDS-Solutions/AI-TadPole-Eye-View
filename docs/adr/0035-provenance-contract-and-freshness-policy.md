# ADR 0035 — Versioned provenance contract and registry-owned freshness policy

**Status:** Accepted

**Date:** 2026-08-29

**Task:** PLAN.md 5.2.1

## Context

GEV provider responses currently expose source-specific batch timestamps but no required,
validated provenance envelope. The executable registry owns provider identity, mode, source,
license text, and attribution, while the server separately owns cache TTLs. The web client
casts unvalidated JSON and shows a hardcoded seed-mode label. This makes retrieval time,
observation time, freshness, cache delivery, fixture identity, and licensing impossible to
distinguish reliably.

PLAN.md §4.2 requires provenance at every provider boundary. Task 5.2.1 also requires frozen-
clock determinism, truthful fresh/stale labels, registry projections, and rejection of
missing or malicious provenance. Cables, satellites, new providers, and economic contracts
remain later tasks.

## Decision

### Contract versions

- `DataProvenance` starts at schema version 1.
- The provider registry advances to version 2 because source and feed records gain required
  license identifiers and freshness policies.
- Every implemented telemetry response carries required `DataProvenance`; payload-only
  schemas remain available for fixture and upstream parsing before provenance is attached.

### Source, license, and identity

The executable registry is the only source for provider/feed IDs, canonical source URL,
source display name, normalized license/terms identifier, license text, attribution, and
freshness policy. Seed responses require a fixture identifier. Cached responses require a
bounded cache identifier and retain the underlying source mode.

Normalized license identifiers are internal stable keys for the registry's existing
source-specific terms; they are not a new legal conclusion or a claim that all sources share
one license.

### Time semantics

Provider-native batch fields such as `FlightBatch.time` remain observation or upstream
snapshot time in Unix seconds. They are never replaced with the local wall clock.
`provenance.retrieved_at` records the provider or cache boundary event using the injected
`SimClock` in ISO 8601 form.

Observation period and source vintage are independent discriminated values. A source that
does not publish a separate vintage identifier reports `unavailable` with a reason; it does
not invent a date. Available observation periods must be ordered and are derived only from
validated upstream or fixture fields.

### Freshness and cache delivery

Each implemented registry feed owns a positive `fresh_for_seconds` policy. Task 5.2.1 maps
that policy to the server's existing fresh-cache TTL so one value drives both classifications.
The server's `maxStaleSeconds` remains a separate failure-fallback retention limit and is not
presented as data freshness.

Freshness age is the nonnegative difference between SimClock retrieval time and the end of
the available observation period. Age at or below the feed threshold is `fresh`; greater age
is `stale`. An unavailable observation period produces unavailable freshness rather than a
fabricated age.

A fresh cache hit changes delivery `mode` to `cached`, records cache identity and original
retrieval time, recomputes freshness at the cache-read SimClock time, and preserves the
underlying `source_mode`, observation period, vintage, fixture identity, source, license, and
attribution.

### Trust boundaries and UI

Adapters validate upstream or fixture payloads, attach registry-derived provenance, and
validate the complete response. Server routes validate again before serialization so a
malformed or provenance-free adapter result fails closed. Overpass performs the same work at
its server-owned provider boundary. The web feed loader validates complete response schemas
before updating stores or Cesium controllers.

The existing HUD badge surface shows a registry/provenance-derived source count, delivery
mode, and aggregate freshness. It does not infer values from environment variables or HTTP
headers and does not create another provider summary.

### Deterministic documentation projection

Task 5.2.4 makes `DATA_SOURCES.md` and `docs/generated/provider-registry.md` deterministic,
marker-delimited projections of the same validated registry. One offline generator updates
both surfaces while preserving authored policy outside the markers; its check mode fails on
missing markers or stale content and never consults wall-clock time, environment secrets, or
the network.

For registry summaries and generated documentation, an entry is active only when its own
implementation is `implemented` and its provider is healthy in `seed` or `live` runtime
mode. Planned, incomplete, disabled/degraded, `download_pack`, and `unavailable` entries
remain registered for truthful discovery but do not increase active counts.

### Cross-platform line endings

The repository owns LF normalization through `.gitattributes`. This makes Biome lint
reproducible on Windows without accepting a broad content or line-ending-only rewrite in the
task diff.

## Consequences

- Missing provenance, invalid URLs, contradictory modes, absent seed fixture identity,
  absent cache identity, unordered observation periods, and unversioned records fail Zod
  validation.
- Fixture replay timestamps remain deterministic while retrieval timestamps follow the
  injected clock.
- Old seed fixtures remain payload artifacts and do not embed runtime retrieval metadata.
- Cached seed data is labeled cached delivery from a seed source, not live data.
- Provider registry version 2 is a deliberate breaking schema change and generated registry
  documentation must be refreshed.
- Registry-backed documentation rows and counts cannot drift silently: generated parity is
  an explicit source-document gate.
- Cables and satellites must adopt this contract in tasks 5.2.2 and 5.2.3 rather than being
  partially implemented here.
