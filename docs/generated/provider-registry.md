# Generated Provider Registry

This file is an offline projection of the typed provider registry. Edit the registry or the
authored source documents, then run `pnpm docs:providers`; do not hand-edit the generated section.

<!-- BEGIN GENERATED: provider-registry -->
## Registry snapshot

Registry version 2; requested mode `seed`.

| Entity | Registered | Active |
|---|---:|---:|
| Providers | 12 | 12 |
| Feeds | 12 | 12 |
| Layers | 12 | 11 |

### Providers

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

### Feeds

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

### Layers

| Layer | Name | Provider | Active | Implementation | Requested mode | Runtime mode | Health | Documentation |
|---|---|---|---|---|---|---|---|---|
| `flights` | ADS-B aviation | `opensky` | yes | `implemented` | `seed` | `seed` | `healthy` | [ADS-B aviation](../data-sources/flights.md) |
| `marine` | AIS maritime | `aisstream` | yes | `implemented` | `seed` | `seed` | `healthy` | [AIS maritime](../data-sources/ships.md) |
| `satellites` | Satellite tracks | `celestrak` | yes | `implemented` | `seed` | `seed` | `healthy` | [Satellite tracks](../data-sources/satellites.md) |
| `quakes` | Earthquakes | `usgs` | yes | `implemented` | `seed` | `seed` | `healthy` | [Earthquakes](../data-sources/quakes.md) |
| `firms` | Wildfires and thermal hotspots | `nasa-firms` | yes | `implemented` | `seed` | `seed` | `healthy` | [Wildfires and thermal hotspots](../data-sources/fires.md) |
| `cctv` | Public traffic cameras | `dot-traffic` | yes | `implemented` | `seed` | `seed` | `healthy` | [Public traffic cameras](../data-sources/cctv.md) |
| `radio` | Radio and ATC stations | `radio-browser` | yes | `implemented` | `seed` | `seed` | `healthy` | [Radio and ATC stations](../data-sources/radio.md) |
| `launches` | Launch trajectories | `launch-replays` | yes | `implemented` | `seed` | `seed` | `healthy` | [Launch trajectories](../data-sources/launches.md) |
| `weather` | Weather and radar | `rainviewer` | yes | `implemented` | `seed` | `seed` | `healthy` | [Weather and radar](../data-sources/weather.md) |
| `gbfs` | Bikeshare stations | `gbfs` | yes | `implemented` | `seed` | `seed` | `healthy` | [Bikeshare stations](../data-sources/gbfs.md) |
| `overpass` | OpenStreetMap query results | `overpass-api` | no | `incomplete` | `seed` | `seed` | `healthy` | [OpenStreetMap query results](../data-sources/overpass.md) |
| `cables` | Submarine cables | `submarine-cables` | yes | `implemented` | `seed` | `seed` | `healthy` | [Submarine cables](../data-sources/cables.md) |

Active counts require an implemented entry on a healthy provider running in `seed` or `live` mode. Planned, incomplete, disabled, download-pack, degraded, and unavailable entries remain registered but are not counted as active.

Implemented provider responses carry DataProvenance schema version 1. Freshness is observation age evaluated against the registry threshold; cache retention is a separate server policy.

License and attribution details are source-specific; see each linked data-source document before enabling live or redistributed data.
<!-- END GENERATED: provider-registry -->
