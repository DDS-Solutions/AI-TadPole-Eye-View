# nowCOAST / NWS Radar — Source and Access Policy

**Layer:** Time-enabled radar reflectivity
**Registry provider:** `noaa-nowcoast`
**Status:** Planned and unavailable; bounded delivery/render spike rejected on 2026-09-06
**Decision:** [ADR 0045](../adr/0045-operational-awareness-source-and-access-policy.md),
[ADR 0048](../adr/0048-bounded-operational-imagery-spike.md)

## Product and provenance

The accepted source is the NWS time-enabled MRMS base-reflectivity
[ArcGIS ImageServer](https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer).
Only bounded ImageServer exports or OGC WMS 1.3.0 images from this fixed service are selected.
Coverage is CONUS, Alaska, the Caribbean, Guam, and Hawaii. The service advertises a moving
four-hour window and updates about every five minutes, but its live metadata exposed only 120.6
minutes during the bounded trial. Clients must derive selectable UTC slices from current
`timeInfo`, and “latest” must not be treated as wall-clock truth.

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

## Bounded spike evidence

The accepted 2026-09-06 trial used one metadata request and one export for longitude
`[-100, -90]`, latitude `[30, 40]`, at source time `2026-09-06T20:58:58.000Z`. The `1024 × 1024`
PNG32 payload was 4,144 bytes. Metadata/export fetch p50 was 2,599.431 ms and p95/max was
7,274.241 ms; peak export-fetch deltas were 0 bytes measured heap and 16,384 bytes RSS. A cached
replay made zero upstream requests.

Transport and image-container bounds passed, but full browser decode, multi-slice playback,
real-Cesium ingestion/update p95, and steady-frame p95 were unmeasurable under the one-slice trial.
The candidate therefore remains planned/unavailable. No live route, fixture, controller, or HUD
control was accepted, and the 12-hour upstream `Cache-Control` value does not override GEV's
source-valid time or five-minute freshness policy.
