# Deterministic Solar Context — Source and Access Policy

**Layer:** Day, night, and twilight context
**Registry provider:** `gev-solar-context`
**Status:** Implemented in task 5.3.2; enabled in deterministic seed mode
**Decision:** [ADR 0045](../adr/0045-operational-awareness-source-and-access-policy.md)

## Product and provenance

The accepted product is a pure-domain calculation of the subsolar point, solar terminator,
and civil, nautical, and astronomical twilight bands from injected `SimClock` UTC time.
Coverage is global, including polar day and polar night. Output is emitted as validated TypeScript
domain objects; there is no upstream response or live-data claim.

Twilight thresholds follow the [U.S. Naval Observatory definitions](https://aa.usno.navy.mil/faq/RST_defs):
the solar center is 6, 12, and 18 degrees below the horizon for civil, nautical, and
astronomical twilight. Implementation conformance uses the published
[NOAA solar equations](https://gml.noaa.gov/grad/solcalc/solareqns.PDF) as reference vectors.
Regression coverage includes the 2024 equinox and solstices, closed 0/-6/-12/-18-degree
boundary rings, and explicit north/south polar light bands.

## Access and operating boundary

- Credentials: none. Network access and secrets are forbidden.
- Environments: development, staging, and production; seed/test/CI remain entirely offline.
- Refresh/cache/stale: calculate at no more than 1 Hz; each value is fresh for one second
  and must never be replaced with wall-clock time.
- Bounds: 100 ms calculation timeout, 256 KiB validated output, one result, one concurrent
  calculation.
- Budget: zero network and monetary cost; the existing Cesium frame budget still applies.
- Kill switch: `GEV_SOLAR_CONTEXT_ENABLED`.
- Failure: hide the overlay and report unavailable.

The authenticated fixed route is `GET /api/operational/solar`. Browser verification may set
`GEV_SEED_SIM_TIME_MS` only outside live provider mode to reproduce a fixture-era SimClock
instant; production otherwise uses the shared server clock.

Attribution is “DDS-Solutions GEV; twilight definitions referenced to U.S. Naval Observatory.”
The GEV implementation will remain under the repository MIT license.
