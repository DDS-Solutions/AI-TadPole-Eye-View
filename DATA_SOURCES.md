# DATA_SOURCES.md — GEV v2 Data Provenance & Attribution

This document summarizes the provenance, data licensing, attribution, and rate-limiting policies for provider-registry entries in God's Eye View v2 (GEV).

---

## 1. Provenance Ethos (PLAN.md §1.3 & §5)

- **Threat-Model-Honest Documentation:** All data paths, proxies, and external API calls are documented with their exact operational boundaries.
- **Honest Labeling:** Telemetry displays clear status indicators (`LIVE`, `INTERPOLATED (RECONSTRUCTED ESTIMATE)`, `PROPAGATED SGP4 EPHEMERIS`, `SEED REPLAY (SIMULATED)`).
- **Zero NC Bundling:** Commercial cleanliness is maintained; non-commercial datasets (such as TeleGeography submarine cables) are isolated into optional download packs requiring explicit operator consent at runtime.
- **Validated Response Metadata:** Every implemented provider response carries required
  `DataProvenance` schema version 1 metadata: registry source/feed identity, canonical URL,
  SimClock retrieval time, explicit observation-period and vintage availability, mode,
  license ID/terms, attribution, fixture or cache identity, and freshness.
- **Time Semantics Stay Separate:** A batch `time` is the source observation time.
  `retrieved_at` is the application retrieval time. Freshness measures observation age;
  cache TTL and maximum stale retention are independent server policies.

---

## 2. Layer Provenance Index

Provider, feed, and layer identities, implementation states, modes, health, source links,
and derived counts are generated from the executable typed registry below and in the
standalone [Generated Provider Registry](./docs/generated/provider-registry.md).

<!-- BEGIN GENERATED: provider-registry -->
### Registry snapshot

Registry version 2; requested mode `seed`.

| Entity | Registered | Active |
|---|---:|---:|
| Providers | 19 | 12 |
| Feeds | 22 | 12 |
| Layers | 19 | 11 |

#### Providers

| Provider | Name | Active | Implementation | Requested mode | Runtime mode | Health | Source | License ID | License / terms | Attribution |
|---|---|---|---|---|---|---|---|---|---|---|
| `opensky` | OpenSky Network | yes | `implemented` | `seed` | `seed` | `healthy` | [OpenSky Network](https://opensky-network.org/) | `opensky-terms-of-use` | OpenSky Network terms of use | The OpenSky Network |
| `aisstream` | AISStream | yes | `implemented` | `seed` | `seed` | `healthy` | [AISStream](https://aisstream.io/) | `aisstream-developer-api-terms` | AISStream developer API terms | AISStream |
| `celestrak` | CelesTrak | yes | `implemented` | `seed` | `seed` | `healthy` | [GEV synthetic satellite fixture](https://github.com/DDS-Solutions/AI-TadPole-Eye-View) | `gev-synthetic-fixture-mit` | MIT synthetic fixture generated for GEV | GEV synthetic orbital elements; no real catalog records |
| `usgs` | U.S. Geological Survey | yes | `implemented` | `seed` | `seed` | `healthy` | [USGS Earthquake Hazards Program](https://earthquake.usgs.gov/) | `us-government-public-domain` | U.S. government public-domain data; source terms apply | U.S. Geological Survey |
| `nasa-firms` | NASA FIRMS | yes | `implemented` | `seed` | `seed` | `healthy` | [NASA Fire Information for Resource Management System](https://firms.modaps.eosdis.nasa.gov/) | `nasa-earthdata-firms-terms` | NASA Earthdata and FIRMS source terms | NASA LANCE / FIRMS MODIS and VIIRS |
| `dot-traffic` | Public traffic camera catalogs | yes | `implemented` | `seed` | `seed` | `healthy` | [State and municipal transportation agencies](https://www.transportation.gov/) | `source-specific-public-feed-terms` | Source-specific public-feed terms | Source transportation agency |
| `radio-browser` | Radio Browser | yes | `implemented` | `seed` | `seed` | `healthy` | [Radio Browser](https://www.radio-browser.info/) | `radio-browser-api-stream-terms` | Radio Browser API terms; individual stream rights remain source-specific | Radio Browser and originating stream operators |
| `launch-replays` | Launch trajectory seed replays | yes | `implemented` | `seed` | `seed` | `healthy` | [Reconstructed public launch telemetry](https://thespacedevs.com/llapi) | `reconstructed-seed-upstream-terms` | Reconstructed seed fixture; upstream source terms apply | The Space Devs and public launch telemetry sources |
| `rainviewer` | RainViewer | yes | `implemented` | `seed` | `seed` | `healthy` | [RainViewer](https://www.rainviewer.com/) | `rainviewer-api-source-agency-terms` | RainViewer API terms; NOAA observations retain source terms | RainViewer and source weather agencies |
| `gbfs` | General Bikeshare Feed Specification | yes | `implemented` | `seed` | `seed` | `healthy` | [Regional GBFS operators](https://gbfs.org/) | `source-specific-open-data-terms` | Source-specific open-data terms | Originating GBFS system operator |
| `overpass-api` | OpenStreetMap Overpass API | yes | `implemented` | `seed` | `seed` | `healthy` | [OpenStreetMap](https://www.openstreetmap.org/) | `odbl-1-0` | Open Database License 1.0; output obligations depend on use | OpenStreetMap contributors |
| `submarine-cables` | Submarine cable catalog | yes | `implemented` | `seed` | `seed` | `healthy` | [GEV procedural synthetic cable fixture](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/tree/main/fixtures) | `gev-synthetic-fixture-mit` | MIT-licensed procedural synthetic fixture | DDS-Solutions GEV synthetic fixture |
| `gev-solar-context` | GEV deterministic solar context | no | `planned` | `seed` | `unavailable` | `unavailable` | [GEV deterministic solar context](https://github.com/DDS-Solutions/AI-TadPole-Eye-View) | `mit` | MIT-licensed GEV pure-domain calculation | DDS-Solutions GEV; twilight definitions referenced to U.S. Naval Observatory |
| `noaa-nws-alerts` | NOAA National Weather Service alerts | no | `planned` | `seed` | `unavailable` | `unavailable` | [NWS Alerts Web Service](https://www.weather.gov/documentation/services-web-alerts) | `us-government-public-domain` | NWS public-domain notice and service-use policy; source-specific exceptions apply | NOAA / National Weather Service |
| `noaa-aviation-weather-center` | NOAA Aviation Weather Center | no | `planned` | `seed` | `unavailable` | `unavailable` | [Aviation Weather Center Data API](https://aviationweather.gov/data/api/) | `us-government-public-domain` | NWS public-domain notice and AWC Data API restrictions; source-specific exceptions apply | NOAA / National Weather Service / Aviation Weather Center |
| `noaa-national-hurricane-center` | NOAA National Hurricane Center | no | `planned` | `seed` | `unavailable` | `unavailable` | [NHC and CPHC GIS advisory feeds](https://www.nhc.noaa.gov/gis/rss.php) | `us-government-public-domain` | NWS public-domain notice; experimental GIS service disclaimer applies | NOAA / National Hurricane Center and Central Pacific Hurricane Center |
| `noaa-coops` | NOAA CO-OPS | no | `planned` | `seed` | `unavailable` | `unavailable` | [NOAA CO-OPS Data and Metadata APIs](https://tidesandcurrents.noaa.gov/web_services_info.html) | `us-government-public-domain` | NOAA public-domain notice; CO-OPS raw-data and prediction disclaimers apply | NOAA / National Ocean Service / CO-OPS |
| `noaa-nowcoast` | NOAA nowCOAST / NWS Map Services | no | `planned` | `seed` | `unavailable` | `unavailable` | [NWS time-enabled MRMS base reflectivity image service](https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer) | `us-government-public-domain` | NWS public-domain notice and map-service appropriate-use policy | NOAA / National Weather Service / MRMS |
| `noaa-goes-glm` | NOAA GOES-R Geostationary Lightning Mapper | no | `planned` | `seed` | `unavailable` | `unavailable` | [GOES-R GLM Level 2 Lightning Detection](https://www.ncei.noaa.gov/metadata/geoportal/rest/metadata/item/gov.noaa.ncdc%3AC01527/html) | `us-government-public-domain` | NOAA public-data notice; dataset citation and product-quality notices apply | NOAA GOES-R Series Program and NOAA National Centers for Environmental Information |

#### Feeds

| Feed | Name | Provider | Active | Implementation | Requested mode | Runtime mode | Health | Freshness |
|---|---|---|---|---|---|---|---|---|
| `flights` | Aircraft state vectors | `opensky` | yes | `implemented` | `seed` | `seed` | `healthy` | 5s |
| `ships` | AIS vessel telemetry | `aisstream` | yes | `implemented` | `seed` | `seed` | `healthy` | 15s |
| `satellites` | Orbital elements | `celestrak` | yes | `implemented` | `seed` | `seed` | `healthy` | 7200s |
| `quakes` | Earthquake events | `usgs` | yes | `implemented` | `seed` | `seed` | `healthy` | 60s |
| `firms` | Thermal hotspots | `nasa-firms` | yes | `implemented` | `seed` | `seed` | `healthy` | 300s |
| `cctv` | Traffic camera catalog | `dot-traffic` | yes | `implemented` | `seed` | `seed` | `healthy` | 10s |
| `radio` | Radio station catalog | `radio-browser` | yes | `implemented` | `seed` | `seed` | `healthy` | 60s |
| `launches` | Launch mission replays | `launch-replays` | yes | `implemented` | `seed` | `seed` | `healthy` | 600s |
| `weather` | Weather and radar seed data | `rainviewer` | yes | `implemented` | `seed` | `seed` | `healthy` | 300s |
| `gbfs` | Bikeshare station status | `gbfs` | yes | `implemented` | `seed` | `seed` | `healthy` | 30s |
| `overpass` | Sanitized OSM queries | `overpass-api` | yes | `implemented` | `seed` | `seed` | `healthy` | 30s |
| `cables` | Submarine cable catalog | `submarine-cables` | yes | `implemented` | `seed` | `seed` | `healthy` | 86400s |
| `solar-context` | SimClock solar position and twilight context | `gev-solar-context` | no | `planned` | `seed` | `unavailable` | `unavailable` | unavailable: Planned deterministic calculation has no runtime freshness yet |
| `nws-alerts` | Active NWS CAP alerts | `noaa-nws-alerts` | no | `planned` | `seed` | `unavailable` | `unavailable` | unavailable: Planned source has no implemented freshness evaluation |
| `aviation-metar` | METAR terminal observations | `noaa-aviation-weather-center` | no | `planned` | `seed` | `unavailable` | `unavailable` | unavailable: Planned observation source has no implemented freshness evaluation |
| `aviation-taf` | TAF terminal forecasts | `noaa-aviation-weather-center` | no | `planned` | `seed` | `unavailable` | `unavailable` | unavailable: Planned forecast source has no implemented validity evaluation |
| `aviation-sigmet` | SIGMET aviation warnings | `noaa-aviation-weather-center` | no | `planned` | `seed` | `unavailable` | `unavailable` | unavailable: Planned warning source has no implemented validity evaluation |
| `tropical-cyclone-advisories` | Current NHC and CPHC GIS advisories | `noaa-national-hurricane-center` | no | `planned` | `seed` | `unavailable` | `unavailable` | unavailable: Planned advisory source has no implemented validity evaluation |
| `coastal-water-levels` | CO-OPS water-level observations and tide predictions | `noaa-coops` | no | `planned` | `seed` | `unavailable` | `unavailable` | unavailable: Planned observation and prediction source has no implemented evaluation |
| `coastal-currents` | CO-OPS current observations and predictions | `noaa-coops` | no | `planned` | `seed` | `unavailable` | `unavailable` | unavailable: Planned observation and prediction source has no implemented evaluation |
| `nowcoast-radar-reflectivity` | Time-enabled MRMS radar base reflectivity | `noaa-nowcoast` | no | `planned` | `seed` | `unavailable` | `unavailable` | unavailable: Bounded delivery and render spike is not complete |
| `goes-glm-lightning` | GOES-18/19 GLM Level 2 flashes | `noaa-goes-glm` | no | `planned` | `seed` | `unavailable` | `unavailable` | unavailable: Bounded NetCDF delivery and render spike is not complete |

#### Layers

| Layer | Name | Provider | Active | Implementation | Requested mode | Runtime mode | Health | Documentation |
|---|---|---|---|---|---|---|---|---|
| `flights` | ADS-B aviation | `opensky` | yes | `implemented` | `seed` | `seed` | `healthy` | [ADS-B aviation](./docs/data-sources/flights.md) |
| `marine` | AIS maritime | `aisstream` | yes | `implemented` | `seed` | `seed` | `healthy` | [AIS maritime](./docs/data-sources/ships.md) |
| `satellites` | Satellite tracks | `celestrak` | yes | `implemented` | `seed` | `seed` | `healthy` | [Satellite tracks](./docs/data-sources/satellites.md) |
| `quakes` | Earthquakes | `usgs` | yes | `implemented` | `seed` | `seed` | `healthy` | [Earthquakes](./docs/data-sources/quakes.md) |
| `firms` | Wildfires and thermal hotspots | `nasa-firms` | yes | `implemented` | `seed` | `seed` | `healthy` | [Wildfires and thermal hotspots](./docs/data-sources/fires.md) |
| `cctv` | Public traffic cameras | `dot-traffic` | yes | `implemented` | `seed` | `seed` | `healthy` | [Public traffic cameras](./docs/data-sources/cctv.md) |
| `radio` | Radio and ATC stations | `radio-browser` | yes | `implemented` | `seed` | `seed` | `healthy` | [Radio and ATC stations](./docs/data-sources/radio.md) |
| `launches` | Launch trajectories | `launch-replays` | yes | `implemented` | `seed` | `seed` | `healthy` | [Launch trajectories](./docs/data-sources/launches.md) |
| `weather` | Weather and radar | `rainviewer` | yes | `implemented` | `seed` | `seed` | `healthy` | [Weather and radar](./docs/data-sources/weather.md) |
| `gbfs` | Bikeshare stations | `gbfs` | yes | `implemented` | `seed` | `seed` | `healthy` | [Bikeshare stations](./docs/data-sources/gbfs.md) |
| `overpass` | OpenStreetMap query results | `overpass-api` | no | `incomplete` | `seed` | `seed` | `healthy` | [OpenStreetMap query results](./docs/data-sources/overpass.md) |
| `cables` | Submarine cables | `submarine-cables` | yes | `implemented` | `seed` | `seed` | `healthy` | [Submarine cables](./docs/data-sources/cables.md) |
| `solar-context` | Day, night, and twilight context | `gev-solar-context` | no | `planned` | `seed` | `unavailable` | `unavailable` | [Day, night, and twilight context](./docs/data-sources/solar-context.md) |
| `nws-alerts` | NWS watches, warnings, and advisories | `noaa-nws-alerts` | no | `planned` | `seed` | `unavailable` | `unavailable` | [NWS watches, warnings, and advisories](./docs/data-sources/nws-alerts.md) |
| `aviation-weather` | Aviation observations, forecasts, and warnings | `noaa-aviation-weather-center` | no | `planned` | `seed` | `unavailable` | `unavailable` | [Aviation observations, forecasts, and warnings](./docs/data-sources/aviation-weather.md) |
| `tropical-cyclones` | Tropical cyclone tracks, cones, and watches/warnings | `noaa-national-hurricane-center` | no | `planned` | `seed` | `unavailable` | `unavailable` | [Tropical cyclone tracks, cones, and watches/warnings](./docs/data-sources/tropical-cyclones.md) |
| `coastal-conditions` | Coastal water levels, tides, and currents | `noaa-coops` | no | `planned` | `seed` | `unavailable` | `unavailable` | [Coastal water levels, tides, and currents](./docs/data-sources/coastal-conditions.md) |
| `nowcoast-radar` | Time-enabled radar reflectivity | `noaa-nowcoast` | no | `planned` | `seed` | `unavailable` | `unavailable` | [Time-enabled radar reflectivity](./docs/data-sources/nowcoast-radar.md) |
| `goes-glm-lightning` | GOES GLM lightning flashes | `noaa-goes-glm` | no | `planned` | `seed` | `unavailable` | `unavailable` | [GOES GLM lightning flashes](./docs/data-sources/goes-glm.md) |

Active counts require an implemented entry on a healthy provider running in `seed` or `live` mode. Planned, incomplete, disabled, download-pack, degraded, and unavailable entries remain registered but are not counted as active.

Implemented provider responses carry DataProvenance schema version 1. Freshness is observation age evaluated against the registry threshold; cache retention is a separate server policy.

License and attribution details are source-specific; see each linked data-source document before enabling live or redistributed data.
<!-- END GENERATED: provider-registry -->

Run `pnpm docs:providers` after changing the typed definitions in
`packages/providers/src/registryDefinitions.ts`. The
generated tables deliberately retain non-active entries for truthful discovery. Run
`pnpm docs:providers:check` to fail when either generated section is stale.

Registry version 2 adds required source license IDs and feed freshness policies. The
implemented feed policies are projected into health responses, server cache TTLs, provider
provenance, and HUD badges; those consumers must not maintain duplicate provider summaries.

---

## 3. Security & Rate Governance

- All outbound telemetry requests pass through `packages/security/pinned-fetch` with TLS IP pinning, SSRF mitigation, and mandatory timeouts.
- Server proxies currently enforce bounded in-process TTL caching and Cost Governor tiers.
  The satellite route instead uses a per-client request limiter because caching its derived
  HTTP body would freeze SimClock-dependent positions; its source catalog remains protected by
  the provider's shared two-hour cache. Redis is not installed; any shared production cache
  requires its own architecture and deployment decision.
- A cached response retains its original `source_mode`, changes response `mode` to `cached`,
  records a bounded cache identity and origin retrieval time, and recomputes freshness with
  the injected SimClock.
