# Aviation Weather — Source and Access Policy

**Layer:** METAR observations, TAF forecasts, and SIGMET warnings
**Registry provider:** `noaa-aviation-weather-center`
**Status:** Planned and unavailable; no live access is enabled
**Decision:** [ADR 0045](../adr/0045-operational-awareness-source-and-access-policy.md)

## Products and provenance

The selected first-party source is the [Aviation Weather Center Data API](https://aviationweather.gov/data/api/).
Only GeoJSON from these fixed products is accepted:

- `https://aviationweather.gov/api/data/metar` — worldwide terminal observations;
- `https://aviationweather.gov/api/data/taf` — worldwide terminal forecasts; and
- `https://aviationweather.gov/api/data/airsigmet` — worldwide SIGMET products exposed by AWC.

Observation time, issue time, forecast validity, and warning valid-from/valid-to values remain
distinct from retrieval and cache time. Expired products disappear; they are never rolled forward.

## Access and operating boundary

- Credentials: no key; a stable descriptive server User-Agent is mandatory.
- Terms record: required from the data/licensing owner before live activation under the
  [NWS disclaimer](https://www.weather.gov/disclaimer/).
- Environments after approval and implementation: development, staging, and production.
- Refresh/cache/stale: 60 seconds / 60 seconds / 2 hours, always bounded by source validity.
- Rate and budget: at most 60 requests/hour/product, below AWC's documented 100 requests/minute;
  normalized AOIs, shared caches, and a 400-record/product ceiling are mandatory.
- Bounds: 10 second timeout, 4 MiB response, 400 records, two concurrent requests.
- Kill switch: `GEV_AWC_WEATHER_ENABLED`.
- Failure: retain last-valid data only within its source validity; otherwise report unavailable.

Attribution is “NOAA / National Weather Service / Aviation Weather Center.” These products are
operational context, not flight-planning or safety-of-flight authority.
