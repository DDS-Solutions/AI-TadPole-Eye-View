# Tropical Cyclones — Source and Access Policy

**Layer:** Tropical cyclone tracks, cones, and coastal watches/warnings
**Registry provider:** `noaa-national-hurricane-center`
**Status:** Planned and unavailable; no RSS or advisory assets are fetched by task 5.3.1
**Decision:** [ADR 0045](../adr/0045-operational-awareness-source-and-access-policy.md)

## Product and provenance

The accepted source is the [NHC/CPHC GIS advisory service](https://www.nhc.noaa.gov/gis/rss.php).
Only the fixed Atlantic, Eastern Pacific, and Central Pacific indexes are selected:
`https://www.nhc.noaa.gov/gis-at.xml`, `https://www.nhc.noaa.gov/gis-ep.xml`, and
`https://www.nhc.noaa.gov/gis-cp.xml`. RSS XML indexes may reference same-origin KMZ/KML
forecast tracks, cones, and coastal watches/warnings.

Advisory number, issue time, forecast valid time, and observation time remain distinct. The
experimental GIS service is not guaranteed to be available continuously or on time and must
not be presented as a life-safety warning system.

## Access and operating boundary

- Credentials: no key; an identifiable server User-Agent and fixed basin allowlist are required.
- Terms record: required from the data/licensing owner before live activation under the
  [NWS disclaimer](https://www.weather.gov/disclaimer/).
- Environments after approval and implementation: development, staging, and production.
- Refresh/cache/stale: 5 minutes / 5 minutes / 6 hours; assets cache by immutable advisory URL.
- Rate and budget: one index request per basin per five minutes, three basin indexes, at most
  256 index items, and one bounded asset per product.
- Bounds: 10 second timeout, 5 MiB response or asset, 256 records, two concurrent requests.
- Kill switch: `GEV_NHC_TROPICAL_CYCLONES_ENABLED`.
- Failure: never substitute archive data as current; label stale advisories and expire them by
  source validity.

Attribution is “NOAA / National Hurricane Center and Central Pacific Hurricane Center.”
