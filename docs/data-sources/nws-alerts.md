# NWS Alerts — Source and Access Policy

**Layer:** Watches, warnings, and advisories
**Registry provider:** `noaa-nws-alerts`
**Status:** Planned and unavailable; task 5.3.1 performs no provider calls
**Decision:** [ADR 0045](../adr/0045-operational-awareness-source-and-access-policy.md)

## Product and provenance

The selected product is the [NWS Alerts Web Service](https://www.weather.gov/documentation/services-web-alerts),
using the fixed active-alert endpoint `https://api.weather.gov/alerts/active`. The allowed
formats are GeoJSON, JSON-LD, and CAP v1.2 XML. Coverage is the United States, territories,
and NWS marine zones; documented CAP coverage gaps must remain visible.

CAP `sent`, `effective`, `onset`, `expires`, `ends`, and update references are distinct.
Retrieval time must not replace any of them. Alerts are official source products but are not
a substitute for emergency alerting or life-safety systems.

## Access and operating boundary

- Credentials: no key; server configuration must supply a stable, contact-bearing User-Agent.
- Terms record: required from the data/licensing owner before live activation. Preserve the
  [NWS disclaimer](https://www.weather.gov/disclaimer/) and NOAA/NWS attribution.
- Environments after approval and implementation: development, staging, and production.
- Refresh/cache/stale: 30 seconds / 30 seconds / 5 minutes.
- Rate and budget: one request per normalized AOI per 30 seconds, at most 120 upstream
  requests/hour, through one shared single-flight cache.
- Bounds: 10 second timeout, 2 MiB response, 500 records, two concurrent requests.
- Kill switch: `GEV_NWS_ALERTS_ENABLED`.
- Failure: label last-valid alerts stale for at most five minutes, then report unavailable.

Attribution is “NOAA / National Weather Service.” Redistribution must preserve source,
timestamps, status, and the documented public-domain exceptions.
