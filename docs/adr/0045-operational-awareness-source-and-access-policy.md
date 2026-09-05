# ADR 0045: Operational-awareness source and access policy

- **Status:** Accepted
- **Date:** 2026-09-05
- **Task:** PLAN.md 5.3.1
- **Evidence cutoff:** 2026-09-05

## Context

PLAN.md §4.6 contained a discovery inventory, not executable registry truth or legal
approval. Task 5.3.1 rechecks every entry against current first-party source, API,
credential, attribution, coverage, time, and operating evidence. It must select a bounded
sequence for Phase 5.3 without calling providers, creating credentials, accepting terms,
or implying that planned functionality is active.

The ranking favors high operational value, first-party access, deterministic or bounded
payloads, clear timestamps, low credential friction, and an implementable cache/rate/budget
policy. A rank is sequencing evidence, not authority to implement the later task.

## Decision

### Re-verification of existing §4.6 entries

| Entry | First-party evidence reviewed | Decision at cutoff |
|---|---|---|
| Flights — OpenSky | [REST API and OAuth2 documentation](https://openskynetwork.github.io/opensky-api/rest.html) | Existing seed provider remains. OAuth2 client credentials are the authenticated path; anonymous limits are lower. Research/non-commercial guidance does not establish commercial production permission, so production terms remain separate and locked. |
| Marine — AISStream | [WebSocket API documentation](https://aisstream.io/documentation) | Existing seed provider remains. A server-side API key, bounded geographic subscription, 200-MMSI ceiling where used, and source terms are required for live activation; browsers must not connect directly. |
| Satellites — CelesTrak | [Current usage policy](https://www.celestrak.org/usage-policy.php) and [GP formats](https://www.celestrak.org/NORAD/documentation/gp-data-formats.php) | ADR 0034 remains controlling: standard GP JSON/OMM, two-hour refresh, and no key. Six-digit catalog support confirms JSON/CSV rather than a TLE-only contract. Commercial production remains terms-locked. |
| Earthquakes — USGS | [real-time GeoJSON feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/) | Existing seed provider remains; the documented GeoJSON feeds are the selected live family. Public-domain/source-credit and freshness rules remain source specific. |
| Wildfires — NASA FIRMS | [API key and transaction guidance](https://firms.modaps.eosdis.nasa.gov/api/map_key/) | Existing seed provider remains. Live access requires a server-held MAP_KEY, 5,000 transactions/10 minutes upstream ceiling, explicit product/geography, payload caps, attribution, and source terms. |
| Traffic cameras | [U.S. DOT data portal](https://data.transportation.gov/) | Existing seed provider remains, but the portal is discovery only. There is no generic authoritative national camera source; every future live agency requires a separate endpoint and rights decision. |
| Radio directory/streams | [Radio Browser API](https://api.radio-browser.info/) | Existing seed provider remains. The open directory requires dynamic server discovery and an identifiable client; directory permission does not grant rights to rebroadcast originating station streams. |
| Launch replays | [Launch Library 2 documentation](https://ll.thespacedevs.com/) | Existing reconstructed seed remains. LL2 v2.3 anonymous access is quota-limited; live use, supporter credentials, fixture rights, and redistribution require a separate implementation/terms decision. |
| Weather radar — RainViewer | [current API terms and limits](https://www.rainviewer.com/api.html) | Existing seed provider remains. Current public access is personal, educational, or small-community use without SLA; commercial live activation remains locked. Current history/rate behavior must be revalidated at implementation. |
| Bikeshare — GBFS | [GBFS v3 reference](https://gbfs.org/documentation/reference/) | Existing seed provider remains. Each regional system's `license_id` or `license_url`, operator attribution, version, geography, and terms must be approved independently. |
| OpenStreetMap/Overpass | [OSM copyright](https://www.openstreetmap.org/copyright) and [public service policies](https://operations.osmfoundation.org/policies/) | Existing feed/incomplete layer remains. ODbL attribution, OQ-5 output classification, endpoint capacity, bounded queries, and service-specific caching/User-Agent policy remain mandatory. |
| Submarine cables | [repository source policy](../data-sources/cables.md) | ADR 0036 remains controlling: GEV-authored synthetic seed plus optional operator-licensed, hash-verified pack. No generic live source is accepted. |

No existing implementation state changes in this decision.

### Ranked Phase 5.3 decisions

| Rank | Candidate | Decision | Reason |
|---:|---|---|---|
| 1 | Deterministic solar context | Accept as planned | Global, credential-free, offline, SimClock-deterministic, and useful to every operational wallboard. |
| 2 | NWS active alerts | Accept as planned | Official CAP semantics, fixed first-party endpoint, high operational value, and a bounded 30-second policy. |
| 3 | AWC METAR/TAF/SIGMET | Accept as planned | Official worldwide aviation products, GeoJSON output, explicit validity, and published request/result ceilings. |
| 4 | NHC/CPHC GIS advisories | Accept as planned | Fixed basin indexes and source advisory assets; experimental/availability warnings can be made explicit. |
| 5 | NOAA CO-OPS coastal conditions | Accept as planned | First-party observation/prediction APIs with explicit station, datum, time-zone, and query-period semantics. |
| 6 | NWS time-enabled MRMS radar | Accept only as a planned bounded spike | Exact moving-window ImageServer/WMS product selected, but delivery and render cost must be measured before implementation. |
| 7 | GOES-R GLM L2 LCFA | Accept only as a planned bounded spike | Exact public NetCDF product and bucket roots selected; decode, payload, latency, and render cost still require measurement. |
| — | Volcano status/history | Defer outside executable registry | [USGS HANS](https://volcanoes.usgs.gov/hans-public/api/volcano/default) has no supported-service guarantee, while the [Smithsonian GVP web services](https://volcano.si.edu/database/webservices.cfm) carry distinct global/history and non-commercial terms. An exact split and permission decision are still missing. |
| — | Current AQI — AirNow | Defer outside executable registry | [AirNow account setup](https://docs.airnowapi.org/account/request/) requires an account/key and data-use acceptance; preliminary current data must remain distinct from validated AQS history. |
| — | NOAA SWPC space weather | Defer outside executable registry | The [SWPC catalog](https://www.swpc.noaa.gov/products-and-data) mixes operational and experimental products. Exact products, endpoints, time semantics, and intended-use warnings are not selected. |
| — | NASA Blue/Black Marble imagery | Defer outside executable registry | [Worldview/GIBS discovery](https://worldview.earthdata.nasa.gov/) exposes multiple layers and access paths with product-specific attribution and resolution. Exact layer, cache, rights, and performance boundaries remain undecided. |

Only the seven ranked entries are added to the typed registry. Deferred candidates remain
planning evidence only and must not be counted or presented as executable layers.

### Accepted products and time semantics

| Registry provider | Exact product/endpoints and format | Coverage and time semantics |
|---|---|---|
| `gev-solar-context` | Pure-domain subsolar point, terminator, and civil/nautical/astronomical twilight as validated TypeScript objects; no endpoint | Global including polar day/night. Injected SimClock UTC is the only time; wall-clock fallback is forbidden. USNO thresholds and NOAA equations are reference evidence. |
| `noaa-nws-alerts` | `https://api.weather.gov/alerts/active`; GeoJSON, JSON-LD, or CAP v1.2 XML | U.S., territories, and NWS marine zones with documented CAP gaps. Preserve `sent`, `effective`, `onset`, `expires`, `ends`, and update references independently. |
| `noaa-aviation-weather-center` | `/api/data/metar`, `/api/data/taf`, `/api/data/airsigmet` at `aviationweather.gov`; GeoJSON only | Worldwide reporting/SIGMET coverage exposed by AWC. Observation, issue, valid-from/to, retrieval, and cache times remain distinct. |
| `noaa-national-hurricane-center` | `gis-at.xml`, `gis-ep.xml`, `gis-cp.xml` plus same-origin KMZ/KML advisory assets | Atlantic, Eastern Pacific, Central Pacific. Preserve advisory number, issue, observation, and forecast-valid time; archive data is never current. |
| `noaa-coops` | CO-OPS `datagetter` and `mdapi/.../stations.json`; JSON water levels, tide predictions, currents, and current predictions | Active U.S. coastal, territorial, and Great Lakes stations. Preserve datum, units, zone, observation/prediction time, and metadata retrieval separately. |
| `noaa-nowcoast` | NWS `radar_base_reflectivity_time/ImageServer`; bounded ImageServer export or WMS 1.3.0 image | CONUS, Alaska, Caribbean, Guam, Hawaii. UTC slices in a moving four-hour window, about five-minute updates; “latest” is not observation time. |
| `noaa-goes-glm` | GOES-18/19 public bucket roots under `GLM-L2-LCFA/`; NetCDF4 20-second granules | Americas and adjacent oceans in GOES-East/West fields of view. Preserve granule start/end/creation, flash, and retrieval times independently. |

### Credential, approval, and operating policy

`record_required` means the designated owner must record reviewed terms and approved use before
live activation. This ADR does not perform click-through acceptance, create an account, submit a
secret, or approve production. All seven entries remain `planned` and resolve to `unavailable`
in seed, live, and download-pack modes.

| Provider | Credential and approval owner | Allowed environments after gates | Refresh / fresh cache / max stale | Rate, budget, and hard bounds | Kill switch and fallback |
|---|---|---|---|---|---|
| Solar | None; no terms record required; `gev-data-licensing-owner` owns the decision record | dev/staging/prod | 1s / 1s / 1s | No network/cost; 100ms, 256KiB, one result, concurrency 1 | `GEV_SOLAR_CONTEXT_ENABLED`; hide and report unavailable, never wall clock |
| NWS alerts | Contact-bearing User-Agent; owner terms record required | dev/staging/prod | 30s / 30s / 300s | One normalized-AOI request/30s, 120/hour; 10s, 2MiB, 500 records, concurrency 2 | `GEV_NWS_ALERTS_ENABLED`; visibly stale to 5m, then unavailable |
| AWC | Descriptive User-Agent; owner terms record required | dev/staging/prod | 60s / 60s / 7,200s, bounded by validity | 60/hour/product, shared AOI cache; 10s, 4MiB, 400 records, concurrency 2 | `GEV_AWC_WEATHER_ENABLED`; valid source data only, then unavailable |
| NHC/CPHC | Identifiable User-Agent and fixed basin allowlist; owner terms record required | dev/staging/prod | 300s / 300s / 21,600s | One index/basin/5m, 3 basins, 256 items; 10s, 5MiB, concurrency 2 | `GEV_NHC_TROPICAL_CYCLONES_ENABLED`; stale label/validity expiry, no archive substitution |
| CO-OPS | Fixed non-secret application identifier; owner terms record required | dev/staging/prod | 360s / 360s / 1,800s | 240/hour, 100-station query ceiling; 10s, 2MiB, 10,000 records, concurrency 4 | `GEV_COOPS_ENABLED`; observations stale to 30m, predictions stop at validity |
| nowCOAST | Identifiable User-Agent and fixed service root; owner terms record required | dev/staging/prod | 300s / 300s / 1,800s | One AOI/time/size export/5m; 1,024px square, one slice, 12/hour; 15s, 4MiB, concurrency 2 | `GEV_NOWCOAST_RADAR_ENABLED`; stale to 30m, no RainViewer fallback |
| GOES GLM | No key; fixed public bucket roots/prefixes; owner terms record required | dev/staging/prod | 20s / 20s / 120s | One listing/satellite/20s; 2 satellites, 30 granules, 2MiB each, 60MiB total, concurrency 2 | `GEV_GOES_GLM_ENABLED`; no alternate source, unavailable after 2m |

Every later external request must still use `pinned-fetch`, contract validation, authentication
where required, shared caches, rate and budget governance, audit, provenance, and the named kill
switch. Provider text and advisory content remain untrusted data and may not become LLM instructions.

## Consequences

- Registered truth expands by seven providers, ten feeds, and seven layers; active truth does not
  change because every accepted entry is planned/unavailable.
- Task 5.3.2 may implement only the first three ranked entries under its own authorized brief.
- Task 5.3.3 may implement NHC and CO-OPS and perform the two bounded imagery spikes only after
  measured evidence; this ADR does not pre-approve full imagery integration.
- A current first-party recheck is required again before implementation or live activation because
  endpoints, quotas, product status, terms, and attribution can change.
- Deferred candidates need a separate ADR or explicit amendment before entering executable registry
  truth.
