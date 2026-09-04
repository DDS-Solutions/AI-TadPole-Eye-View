# ADR 0034 — CelesTrak GP/OMM satellite source and access policy

**Status:** Accepted
**Date:** 2026-09-04
**Task:** PLAN.md OQ-7 and 5.2.3

## Context

Task 5.2.3 needs one bounded satellite source before contracts, propagation, caching,
rendering, and operator access can be implemented. Public availability is not by itself
permission to display, cache, transform, or redistribute orbital data, and a TLE-only
contract cannot represent the expanding catalog safely.

The developer approved OQ-7 Option A on 2026-09-04. The decision uses CelesTrak standard
General Perturbations (GP) data expressed with Orbit Mean-Elements Message (OMM) keywords,
while keeping production access locked until the licensing condition below is met.

Evidence reviewed on 2026-09-04:

- [CelesTrak GP data formats and query contract](https://celestrak.org/NORAD/documentation/gp-data-formats.php)
- [CelesTrak data-usage policy](https://www.celestrak.org/usage-policy.php)
- [CelesTrak redistribution system notices](https://celestrak.org/NORAD/elements/notice.php)
- [Space-Track SSA sharing, redistribution, and service documentation](https://www.space-track.org/documentation)

CelesTrak documents JSON output using OMM keywords, 1-to-9-digit catalog numbers, server
queries by named group, and a two-hour source update cycle. Its usage policy requires clients
to download only what they need and no more than once per update. Space-Track states that
USSPACECOM has given express blanket approval to transfer or redistribute Basic SSA data,
including OMM, when appropriately cited. Historical CelesTrak notices record continuing
authority to redistribute Space-Track data, but they are not a modern downstream commercial
license issued directly to DDS-Solutions. That residual uncertainty is handled as an access
gate rather than silently interpreted as permission.

## Decision

### Source and format

- The selected source is CelesTrak's standard GP endpoint at the fixed
  `https://celestrak.org/NORAD/elements/gp.php` path.
- Requests use `GROUP=<server-owned allowlisted group>&FORMAT=JSON`. Callers cannot supply a
  URL, arbitrary group, alternate format, or special query.
- The provider parses JSON fields with OMM names into a strict GP/OMM domain contract. TLE,
  2LE, 3LE, direct Space-Track, special queries, historical queries, and supplemental GP
  (SupGP) are outside task 5.2.3.
- The configured allowlist and the combined accepted catalog are bounded. No response may
  expose or render more than 1,000 satellite records.
- CelesTrak requires no API key. The lack of a credential does not bypass the independent
  terms, environment, runtime, budget, provenance, or kill-switch gates.

### Fixture and redistribution boundary

- Seed mode ships one small, time-frozen, GEV-authored synthetic GP/OMM fixture. It contains
  no copied CelesTrak or Space-Track catalog, real object names, or real catalog identifiers.
- Any SGP4 conformance vectors are separately identified test evidence with their own
  compatible license; they are not presented as the satellite layer's catalog.
- The application may deliver derived propagated positions and the minimum element metadata
  required for inspection and provenance. It does not expose a raw GP passthrough, bulk
  catalog mirror, or catalog download feature.
- Attribution is always visible as: “Orbital elements: CelesTrak; Basic SSA data: U.S. Space
  Force / 18 SDS via Space-Track.org,” with links to the named sources.

### Refresh, cache, rate, and budget policy

- Seed mode is the default in development, tests, and CI and opens no network sockets.
- Live retrieval is server-only through `pinned-fetch`, disabled by default, and requires an
  explicit environment enablement plus the satellite kill switch.
- Each allowlisted group may be fetched successfully no more than once in any two-hour
  window. One shared single-flight cache fans that result out to all consumers; browser,
  tenant, and session fan-out never creates additional upstream requests.
- Registry `fresh_for_seconds` and the shared fresh-cache TTL are both 7,200 seconds. A failed
  refresh may retain the last valid response for no more than 86,400 seconds, but it must be
  labeled stale and degrade provider health. After that bound, the live catalog is
  unavailable rather than propagated further.
- The source is currently classified as no-monetary-charge, but reads remain governed.
  The hard upstream budget is the two-hour per-group rate plus the 1,000-record catalog
  ceiling; transport byte, timeout, retry, and concurrency limits remain mandatory.
- HTTP errors, schema failures, oversized catalogs, and budget/rate rejection stop refresh;
  they never trigger a tight retry loop or a fallback to an unapproved source.

### Production access and ownership

- Development and staging live access may be enabled only by an explicit developer
  instruction. Implementing or testing task 5.2.3 does not itself authorize a live call.
- Production remains visibly locked until either CelesTrak supplies written confirmation
  covering the intended commercial display, caching, transformation, and derived-data use,
  or the designated licensing owner formally accepts the cited evidence through the §4.5
  audited terms-approval record.
- Until then, the layer remains discoverable with the reason `TERMS_APPROVAL_REQUIRED`, the
  message “No API key required,” and the relevant setup, terms, and attribution links.
- The GEV platform administrator owns `GEV_SATELLITES_ENABLED` and may disable retrieval,
  propagation, and rendering before dispatch. A disabled or revoked decision relocks the
  layer without deleting the approval history.

### Product claims and safety boundary

Every rendered coordinate is labeled as a propagated estimate from a named element-set
epoch and retrieval vintage. Retrieval freshness and orbital-element epoch are distinct and
both remain inspectable. The layer must never claim to show a live or authoritative
position, and it is not approved for navigation, conjunction assessment, collision
avoidance, maneuver planning, or other safety-of-flight operations.

## Consequences

- OQ-7 is resolved: CelesTrak standard GP JSON/OMM is the selected technical source, while
  production activation has a deterministic licensing lock.
- Task 5.2.3 may be briefed for authorization, but this ADR alone does not authorize its
  implementation or any live source call.
- Direct Space-Track integration would require a new decision covering accounts, passwords,
  user-agreement obligations, and the §4.5 rule that GEV does not store provider passwords.
- SupGP and commercial ephemeris products require separate source, rights, accuracy, and
  attribution review.
- The executable registry, provider documentation, tests, and Layer Access UI must derive
  the selected source and gate state without presenting the production layer as active.
