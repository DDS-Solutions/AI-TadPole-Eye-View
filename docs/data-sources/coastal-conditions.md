# Coastal Conditions — Source and Access Policy

**Layer:** Coastal water levels, tides, and currents
**Registry provider:** `noaa-coops`
**Status:** Synthetic seed implemented; production live access remains fail-closed
**Decision:** [ADR 0045](../adr/0045-operational-awareness-source-and-access-policy.md),
[ADR 0047](../adr/0047-coastal-and-tropical-operational-awareness-baseline.md)

## Products and provenance

The accepted source is the [NOAA CO-OPS Data and Metadata APIs](https://tidesandcurrents.noaa.gov/web_services_info.html).
The fixed data endpoint is `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter`;
the station inventory is `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json`.
Selected JSON products are water-level observations, tide predictions, current observations,
and current predictions for active U.S. coastal, territorial, and Great Lakes stations.

The product parameters and response fields were re-verified against the first-party
[CO-OPS API documentation](https://api.tidesandcurrents.noaa.gov/api/dev),
[response help](https://api.tidesandcurrents.noaa.gov/api/prod/responseHelp.html), and
[metadata API](https://api.tidesandcurrents.noaa.gov/mdapi/prod/) on 2026-09-06. The committed
`coops-coastal-synthetic-v1` fixture is self-authored and time-frozen; seed/test/CI make no live
CO-OPS request.

Observation, prediction, datum, units, station metadata, and requested time zone remain explicit.
Each station retains metadata retrieval time and the station's named local time zone separately
from the requested API time zone. Water/current observations and tide/current predictions use
different collections and timestamps. Preliminary/verified identity and source flags remain
visible. A missing or suppressed measurement is `unavailable`, never numeric zero.
Preliminary observations and model guidance must retain the limitations in the
[CO-OPS disclaimers](https://tidesandcurrents.noaa.gov/disclaimers.html).

## Access and operating boundary

- Credentials: no secret or account; each data request requires a fixed non-secret application ID.
- Terms record: required from the data/licensing owner before live activation.
- Environments after approval: development, staging, and production. Seed mode is the default.
- Refresh/cache/stale: 6 minutes / 6 minutes / 30 minutes. Predictions never extend past validity.
- Rate and budget: at most 240 requests/hour; normalized AOI station allowlist and a 100-station
  query ceiling are mandatory.
- Bounds: 10 second timeout, 2 MiB response, 10,000 records, four concurrent station requests.
- Kill switch: `GEV_COOPS_ENABLED`.
- Failure: observations may remain visibly stale for at most 30 minutes and are then removed;
  predictions are removed after their validity time. Fixed metadata/data roots and the four
  allowlisted product names are the only accepted live access surface.

Attribution is “NOAA / National Ocean Service / CO-OPS.” Observations and predictions may not be
collapsed into one truth value.
