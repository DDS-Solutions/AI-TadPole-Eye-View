# nowCOAST / NWS Radar — Source and Access Policy

**Layer:** Time-enabled radar reflectivity
**Registry provider:** `noaa-nowcoast`
**Status:** Planned and unavailable; bounded delivery/render spike not started
**Decision:** [ADR 0045](../adr/0045-operational-awareness-source-and-access-policy.md)

## Product and provenance

The accepted source is the NWS time-enabled MRMS base-reflectivity
[ArcGIS ImageServer](https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer).
Only bounded ImageServer exports or OGC WMS 1.3.0 images from this fixed service are selected.
Coverage is CONUS, Alaska, the Caribbean, Guam, and Hawaii. The service publishes UTC slices
in a moving four-hour window and updates about every five minutes; “latest” must not be treated
as wall-clock truth.

## Access and operating boundary

- Credentials: no key; an identifiable server User-Agent and fixed service root are required.
- Terms record: required from the data/licensing owner before live activation under the
  [NWS disclaimer](https://www.weather.gov/disclaimer/).
- Environments after approval and implementation: development, staging, and production.
- Refresh/cache/stale: 5 minutes / 5 minutes / 30 minutes.
- Rate and budget: one export per normalized AOI/time/size per five minutes; the later spike is
  capped at 1,024 by 1,024 pixels, one time slice, and 12 refreshes/hour.
- Bounds: 15 second timeout, 4 MiB image, one image record, two concurrent requests.
- Kill switch: `GEV_NOWCOAST_RADAR_ENABLED`.
- Failure: use a visibly stale image for at most 30 minutes, then report unavailable. RainViewer
  is not an automatic fallback because its commercial terms differ.

Attribution is “NOAA / National Weather Service / MRMS.”
