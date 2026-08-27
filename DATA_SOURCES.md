# DATA_SOURCES.md — GEV v2 Data Provenance & Attribution

This document summarizes the provenance, data licensing, attribution, and rate-limiting policies for provider-registry entries in God's Eye View v2 (GEV).

---

## 1. Provenance Ethos (PLAN.md §1.3 & §5)

- **Threat-Model-Honest Documentation:** All data paths, proxies, and external API calls are documented with their exact operational boundaries.
- **Honest Labeling:** Telemetry displays clear status indicators (`LIVE`, `INTERPOLATED (RECONSTRUCTED ESTIMATE)`, `PROPAGATED SGP4 EPHEMERIS`, `SEED REPLAY (SIMULATED)`).
- **Zero NC Bundling:** Commercial cleanliness is maintained; non-commercial datasets (such as TeleGeography submarine cables) are isolated into optional download packs requiring explicit operator consent at runtime.

---

## 2. Layer Provenance Index

Provider, feed, and layer identities, implementation states, modes, health, source links,
and derived counts are generated from the executable typed registry:

- [Generated Provider Registry](./docs/generated/provider-registry.md)

Run `pnpm docs:providers` after changing `packages/providers/src/registry.ts`. The
generated table deliberately includes planned and incomplete entries but does not count
them as active.

---

## 3. Security & Rate Governance

- All outbound telemetry requests pass through `packages/security/pinned-fetch` with TLS IP pinning, SSRF mitigation, and mandatory timeouts.
- Server proxies enforce dynamic rate-limits, Redis caching, and Cost Governor TTL tiering.
