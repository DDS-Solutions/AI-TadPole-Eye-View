# Tropical Cyclones — Source and Access Policy

**Layer:** Tropical cyclone tracks, cones, and coastal watches/warnings
**Registry provider:** `noaa-national-hurricane-center`
**Status:** Synthetic seed implemented; production live access remains fail-closed
**Decision:** [ADR 0045](../adr/0045-operational-awareness-source-and-access-policy.md),
[ADR 0047](../adr/0047-coastal-and-tropical-operational-awareness-baseline.md)

## Product and provenance

The accepted source is the [NHC/CPHC GIS advisory service](https://www.nhc.noaa.gov/gis/rss.php).
Only the fixed Atlantic, Eastern Pacific, and Central Pacific indexes are selected:
`https://www.nhc.noaa.gov/gis-at.xml`, `https://www.nhc.noaa.gov/gis-ep.xml`, and
`https://www.nhc.noaa.gov/gis-cp.xml`. RSS XML indexes may reference same-origin KMZ/KML
forecast tracks, cones, and coastal watches/warnings.

The selected topology and product naming were re-verified against the first-party
[NHC GIS RSS documentation](https://www.nhc.noaa.gov/gis/rss.php) and
[NHC GIS data page](https://www.nhc.noaa.gov/gis/) on 2026-09-06. The committed
`nhc-advisories-synthetic-v1` fixture is a self-authored, time-frozen exercise storm; it is not a
copied NOAA advisory and opens no network connection in seed/test/CI.

Advisory number, issue time, forecast valid time, and observation time remain distinct. The
experimental GIS service is not guaranteed to be available continuously or on time and must
not be presented as a life-safety warning system.

## Access and operating boundary

- Credentials: no key; an identifiable server User-Agent and fixed basin allowlist are required.
- Terms record: required from the data/licensing owner before live activation under the
  [NWS disclaimer](https://www.weather.gov/disclaimer/).
- Environments after approval: development, staging, and production. Seed mode is the default.
- Refresh/cache/stale: 5 minutes / 5 minutes / 6 hours; assets cache by immutable advisory URL.
- Rate and budget: one index request per basin per five minutes, three basin indexes, at most
  256 index items, and one bounded asset per product.
- Bounds: 10 second timeout, 5 MiB compressed response or asset, 256 index items, two concurrent
  requests, 32 archive entries, and 20 MiB total expanded KMZ content.
- Kill switch: `GEV_NHC_TROPICAL_CYCLONES_ENABLED`.
- Failure: reject active/entity-bearing XML, non-HTTPS or cross-origin asset links, traversal,
  absolute or ambiguous archive paths, nested archives, unsupported compression, and mismatched
  expanded sizes. Never substitute historical archive data as current; stale advisories retain a
  visible freshness state only while source-valid and are removed at `valid_to`.

Rendering uses ordinary bounded Cesium entities through `cesium-kit`; the September 2026 Cesium
vector-tiles technology preview is not part of this baseline. Attribution is “NOAA / National
Hurricane Center and Central Pacific Hurricane Center.” The HUD visibly states that experimental
GIS data is not for navigation or life-safety decisions.
