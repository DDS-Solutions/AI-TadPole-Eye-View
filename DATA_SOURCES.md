# DATA_SOURCES.md — GEV v2 Data Provenance & Attribution

This document summarizes the provenance, data licensing, attribution, and rate-limiting policies for provider-registry entries in God's Eye View v2 (GEV).

---

## 1. Provenance Ethos (PLAN.md §1.3 & §5)

- **Threat-Model-Honest Documentation:** All data paths, proxies, and external API calls are documented with their exact operational boundaries.
- **Honest Labeling:** Telemetry displays clear status indicators (`LIVE`, `INTERPOLATED (RECONSTRUCTED ESTIMATE)`, `PROPAGATED SGP4 EPHEMERIS`, `SEED REPLAY (SIMULATED)`).
- **Zero NC Bundling:** Commercial cleanliness is maintained; non-commercial datasets (such as TeleGeography submarine cables) are isolated into optional download packs requiring explicit operator consent at runtime.
- **Validated Response Metadata:** Every implemented provider response carries required
  `DataProvenance` schema version 1 metadata: registry source/feed identity, canonical URL,
  SimClock retrieval time, explicit observation-period and vintage availability, mode,
  license ID/terms, attribution, fixture or cache identity, and freshness.
- **Time Semantics Stay Separate:** A batch `time` is the source observation time.
  `retrieved_at` is the application retrieval time. Freshness measures observation age;
  cache TTL and maximum stale retention are independent server policies.

---

## 2. Layer Provenance Index

Provider, feed, and layer identities, implementation states, modes, health, source links,
and derived counts are generated from the executable typed registry:

- [Generated Provider Registry](./docs/generated/provider-registry.md)

Run `pnpm docs:providers` after changing the typed definitions in
`packages/providers/src/registryDefinitions.ts`. The
generated table deliberately includes planned and incomplete entries but does not count
them as active.

Registry version 2 adds required source license IDs and feed freshness policies. The
implemented feed policies are projected into health responses, server cache TTLs, provider
provenance, and HUD badges; those consumers must not maintain duplicate provider summaries.

---

## 3. Security & Rate Governance

- All outbound telemetry requests pass through `packages/security/pinned-fetch` with TLS IP pinning, SSRF mitigation, and mandatory timeouts.
- Server proxies currently enforce bounded in-process TTL caching and Cost Governor tiers.
  The satellite route instead uses a per-client request limiter because caching its derived
  HTTP body would freeze SimClock-dependent positions; its source catalog remains protected by
  the provider's shared two-hour cache. Redis is not installed; any shared production cache
  requires its own architecture and deployment decision.
- A cached response retains its original `source_mode`, changes response `mode` to `cached`,
  records a bounded cache identity and origin retrieval time, and recomputes freshness with
  the injected SimClock.
