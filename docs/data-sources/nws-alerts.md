# NWS Alerts — Source and Access Policy

**Layer:** Watches, warnings, and advisories
**Registry provider:** `noaa-nws-alerts`
**Status:** Seed implementation active; live production access remains approval-locked
**Decision:** [ADR 0045](../adr/0045-operational-awareness-source-and-access-policy.md)

## Product and provenance

The selected product is the [NWS Alerts Web Service](https://www.weather.gov/documentation/services-web-alerts),
using the fixed active-alert endpoint `https://api.weather.gov/alerts/active`. The implementation
accepts bounded GeoJSON. Coverage is the United States, territories,
and NWS marine zones; documented CAP coverage gaps must remain visible.

CAP `sent`, `effective`, `onset`, `expires`, `ends`, and update references are distinct.
Retrieval time must not replace any of them. Alerts are official source products but are not
a substitute for emergency alerting or life-safety systems.

## Access and operating boundary

- Credentials: no key; server configuration must supply a stable, contact-bearing User-Agent.
- Terms record: required from the data/licensing owner before live activation. Preserve the
  [NWS disclaimer](https://www.weather.gov/disclaimer/) and NOAA/NWS attribution.
- Seed fixture: `fixtures/nws-alerts-synthetic-v1.geojson`, containing only GEV-authored
  schema-shaped test alerts under MIT.
- Fixed authenticated route: `GET /api/operational/alerts` with all four bounded AOI values.
- Live gates: `GEV_NWS_ALERTS_LIVE_ACCESS=1` and `GEV_NWS_ALERTS_TERMS_APPROVED=1`, in
  addition to live mode and a contact-bearing `GEV_NWS_USER_AGENT`. Missing gates stop before HTTP.
- Environments after approval: development, staging, and production. Seed/test/CI make zero
  provider requests.
- Refresh/cache/stale: 30 seconds / 30 seconds / 5 minutes.
- Rate and budget: one request per normalized AOI per 30 seconds, at most 120 upstream
  requests/hour, through one shared single-flight cache.
- Bounds: 10 second timeout, 2 MiB response, 500 records, two concurrent requests.
- Kill switch: `GEV_NWS_ALERTS_ENABLED`.
- Failure: cached last-valid alerts may be labeled stale for at most five minutes; source data
  older than five minutes is rejected as unavailable and removed from the globe.

Attribution is “NOAA / National Weather Service.” Redistribution must preserve source,
timestamps, status, and the documented public-domain exceptions.
