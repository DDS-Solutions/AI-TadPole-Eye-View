# Coastal Conditions — Source and Access Policy

**Layer:** Coastal water levels, tides, and currents
**Registry provider:** `noaa-coops`
**Status:** Planned and unavailable; station selection and adapters are later work
**Decision:** [ADR 0045](../adr/0045-operational-awareness-source-and-access-policy.md)

## Products and provenance

The accepted source is the [NOAA CO-OPS Data and Metadata APIs](https://tidesandcurrents.noaa.gov/web_services_info.html).
The fixed data endpoint is `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter`;
the station inventory is `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json`.
Selected JSON products are water-level observations, tide predictions, current observations,
and current predictions for active U.S. coastal, territorial, and Great Lakes stations.

Observation, prediction, datum, units, station metadata, and requested time zone remain explicit.
Preliminary observations and model guidance must retain the limitations in the
[CO-OPS disclaimers](https://tidesandcurrents.noaa.gov/disclaimers.html).

## Access and operating boundary

- Credentials: no secret or account; each data request requires a fixed non-secret application ID.
- Terms record: required from the data/licensing owner before live activation.
- Environments after approval and implementation: development, staging, and production.
- Refresh/cache/stale: 6 minutes / 6 minutes / 30 minutes. Predictions never extend past validity.
- Rate and budget: at most 240 requests/hour; normalized AOI station allowlist and a 100-station
  query ceiling are mandatory.
- Bounds: 10 second timeout, 2 MiB response, 10,000 records, four concurrent station requests.
- Kill switch: `GEV_COOPS_ENABLED`.
- Failure: last-valid observations may remain visibly stale for 30 minutes, then become unavailable.

Attribution is “NOAA / National Ocean Service / CO-OPS.” Observations and predictions may not be
collapsed into one truth value.
