# Submarine Cables — Source, Fixture, and Licensed-Pack Policy

**Layer:** Submarine cable routes and landing points

**Package:** `packages/providers/src/cables.ts`

**Implemented default:** validated procedural seed fixture

**Optional source:** operator-licensed TeleGeography map data

**Decision:** [ADR 0036](../adr/0036-cable-fixture-and-licensed-pack-policy.md)

## Implemented seed source

The default catalog is `fixtures/cables-synthetic-v1.json`. It is a small,
procedurally authored GEV test fixture under the repository's MIT license. Names,
ownership, geometry, dates, and landing points are explicitly synthetic and must not
be presented as TeleGeography data, measured cable routes, or current infrastructure.

Seed mode reads only this checked-in file, validates the complete catalog, adds
`DataProvenance` schema version 1 with the injected `SimClock`, and opens no network
sockets. The executable registry owns the seed source name, license identifier,
attribution, 24-hour freshness/cache policy, mode, and health.

## Optional licensed pack

TeleGeography's current official guidance distinguishes publicly viewable maps from
the raw geocoded data behind them. Public map references and screenshots have a map-
citation policy; underlying GeoJSON/JSON data is available through an annual license.
TeleGeography also states that it no longer maintains the former public GitHub data
repository. See the official [Submarine Cable FAQ](https://www2.telegeography.com/submarine-cable-faqs-frequently-asked-questions),
[map-data licensing page](https://www2.telegeography.com/license-geocoded-map-data),
and [map-citation page](https://www2.telegeography.com/cite-telegeography-map).

Accordingly, GEV has no public TeleGeography download URL, no bundled TeleGeography
geometry, and no default licensed-pack manifest. An operator who has appropriate
rights may configure a server-owned manifest for a canonical GEV cable catalog. The
browser and activation caller cannot supply a URL, path, hash, or license-consent
boolean.

A configured pack is accepted only when all of these checks pass:

- authenticated local human authorization and shared approval/budget/STASIS control;
- HTTPS through `pinned-fetch` with an exact manifest host and path prefix;
- mandatory expected SHA-256, response byte limit, timeout, and no redirects;
- bounded route, landing-point, segment, and coordinate counts;
- strict Zod catalog and required provenance validation before atomic activation.

Failed download, digest, or contract validation leaves the last valid catalog active.
Until a verified pack succeeds, mode and health continue to describe the seed source;
the system never silently claims licensed-pack mode.

## Normalized fields and rendering

Landing points carry bounded IDs, names, country labels, and WGS84 coordinates. Routes
carry status, owner labels, optional RFS year and length, referenced landing-point IDs,
and bounded multi-segment WGS84 geometry. Route colors from external content are not
accepted; Cesium uses the design-system submarine-infrastructure token. TeleGeography
notes that its displayed routes are stylized rather than precise cable geolocations.

Set `GEV_CABLES_ENABLED=0` to disable both seed reads and licensed-pack fetches before
dispatch. Health then reports the implemented provider as degraded rather than
claiming a healthy feed.
