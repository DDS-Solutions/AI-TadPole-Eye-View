# ADR 0036 — Cable fixture and operator-licensed pack policy

**Status:** Accepted  
**Date:** 2026-08-30  
**Task:** PLAN.md 5.2.2

## Context

The pre-task cable helper embedded three synthetic objects behind local TypeScript
interfaces and offered a caller-selected URL, optional digest, random ID fallback,
and a `licenseAccepted` boolean. It had no contract, fixture boundary, server route,
registry truth, Cesium layer, or web store. ADR 0029 also described the former public
TeleGeography repository as a CC BY-NC-SA 4.0 download pack.

Current official TeleGeography material does not support that raw-data conclusion.
The company states that it no longer maintains the former public GitHub data/source
repository and that raw geocoded data behind its interactive maps is supplied under
an annual license. Its CC BY-SA 4.0 citation policy covers references to public maps,
URLs, and related screen captures—not an unrestricted raw-data download pack.

Evidence reviewed on 2026-08-30:

- [TeleGeography Submarine Cable FAQ](https://www2.telegeography.com/submarine-cable-faqs-frequently-asked-questions)
- [TeleGeography map-data licensing](https://www2.telegeography.com/license-geocoded-map-data)
- [TeleGeography map citation](https://www2.telegeography.com/cite-telegeography-map)

## Decision

### Seed catalog

GEV ships one small procedural fixture, `fixtures/cables-synthetic-v1.json`, under
the repository's MIT license. Every name, route, landing point, owner, date, and
coordinate is labeled synthetic. Contracts bound identifiers, strings, feature
counts, segment depth, coordinate counts, and WGS84 ranges; route references must
resolve to unique landing-point IDs.

`CableAdapter` reads the fixture only after the cable kill switch passes, attaches
required `DataProvenance` v1 using `SimClock`, and validates the complete response.
The registry identifies the synthetic source and owns its license, attribution,
freshness/cache policy, health, and seed mode.

### Optional operator-licensed pack

The repository contains no TeleGeography geometry and no default remote manifest.
An appropriately licensed operator may inject a server-owned `CablePackManifest` for
a canonical GEV cable catalog. The caller selects only a bounded manifest ID. The
manifest—not the request—owns the HTTPS URL, exact host/path allowlist, mandatory
SHA-256, response-size limit, and timeout.

The loader uses `pinned-fetch`, verifies the digest over received bytes, validates
the complete bounded catalog, attaches registry-derived licensed-source provenance,
and returns an immutable candidate. The server swaps the active catalog, registry
mode/source, and cache only after every check succeeds. Any failure leaves the last
valid seed or pack state unchanged.

### Governance and availability

Pack activation is a protected local `/ops/cables/packs/activate` action. It requires
authenticated human identity and executes through the shared governed `set_flag`
path, producing a zero-cost durable reservation, audit intent, approval decision,
STASIS/budget check, action, settlement, and audit outcome. A request boolean is not
license consent and is never accepted.

Because there is no repository-owned annual license or stable public raw-data
endpoint, download-pack mode is unavailable by default. It becomes active only after
a configured manifest passes authorization, transport, integrity, contract, and
provenance validation. `GEV_CABLES_ENABLED=0` prevents both fixture and pack reads
before dispatch and degrades registry health truthfully.

### Rendering

`CableLayerController` owns Cesium route and landing-point entities. It drains one
validated catalog through the shared rAF queue and ignores external color fields.
The accepted DESIGN.md submarine-infrastructure channel is `#f472b6`; no pack content
controls rendering style.

## Consequences

- Seed mode is commercially clean, deterministic, and network-free.
- Old public GitHub/raw endpoint assumptions and CC BY-NC-SA 4.0 raw-data claims are
  superseded by current official licensing evidence.
- Licensed deployments must perform their own contract-compatible pack preparation
  and retain proof of rights; GEV does not infer those rights.
- A rejected pack cannot partially activate or silently relabel seed data.
- Route geometry remains a visualization and must not be described as precise cable
  geolocation without source-specific evidence.
