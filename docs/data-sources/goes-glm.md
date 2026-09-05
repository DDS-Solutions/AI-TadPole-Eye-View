# GOES-R GLM Lightning — Source and Access Policy

**Layer:** Geostationary Lightning Mapper flashes
**Registry provider:** `noaa-goes-glm`
**Status:** Planned and unavailable; bounded NetCDF delivery/render spike not started
**Decision:** [ADR 0045](../adr/0045-operational-awareness-source-and-access-policy.md)

## Product and provenance

The selected product is [GOES-R GLM Level 2 Lightning Detection](https://www.ncei.noaa.gov/metadata/geoportal/rest/metadata/item/gov.noaa.ncdc%3AC01527/html),
product `GLM-L2-LCFA`. Only NetCDF4 20-second granules beneath the fixed public bucket roots
`https://noaa-goes18.s3.amazonaws.com/GLM-L2-LCFA/` and
`https://noaa-goes19.s3.amazonaws.com/GLM-L2-LCFA/` are accepted. Coverage is the Americas
and adjacent oceans within the GOES-East/West GLM fields of view.

Granule start, end, and creation times plus flash event times remain distinct from retrieval.
Dataset citation is DOI `10.7289/V5KH0KK6`; attribution is “NOAA GOES-R Series Program and
NOAA National Centers for Environmental Information.”

## Access and operating boundary

- Credentials: none; public bucket roots and product prefixes are fixed and validated.
- Terms record: required from the data/licensing owner before live activation under the
  [NOAA disclaimer](https://www.noaa.gov/disclaimer).
- Environments after approval and implementation: development, staging, and production.
- Refresh/cache/stale: 20 seconds / 20 seconds / 2 minutes; immutable granules fetch once.
- Rate and budget: one object listing per satellite per 20 seconds; two satellites, 30 granules,
  2 MiB per granule, and 60 MiB total input per bounded spike.
- Bounds: 15 second timeout, 2 MiB per response, 30 records, two concurrent requests.
- Kill switch: `GEV_GOES_GLM_ENABLED`.
- Failure: no alternate lightning source; report unavailable after two minutes.

This operational layer is not a strike-level safety, forensic, or person-tracking service.
