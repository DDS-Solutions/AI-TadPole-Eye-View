# DATA_SOURCES.md — GEV v2 Data Provenance & Attribution

This document summarizes the provenance, data licensing, attribution, and rate-limiting policies across all 13 geospatial layers in God's Eye View v2 (GEV).

---

## 1. Provenance Ethos (PLAN.md §1.3 & §5)

- **Threat-Model-Honest Documentation:** All data paths, proxies, and external API calls are documented with their exact operational boundaries.
- **Honest Labeling:** Telemetry displays clear status indicators (`LIVE`, `INTERPOLATED (RECONSTRUCTED ESTIMATE)`, `PROPAGATED SGP4 EPHEMERIS`, `SEED REPLAY (SIMULATED)`).
- **Zero NC Bundling:** Commercial cleanliness is maintained; non-commercial datasets (such as TeleGeography submarine cables) are isolated into optional download packs requiring explicit operator consent at runtime.

---

## 2. Layer Provenance Index

| # | Layer | Primary Source | License / Terms | Documentation |
|---|---|---|---|---|
| 1 | **Flights** | [OpenSky Network](https://opensky-network.org/) · [adsb.lol](https://adsb.lol/) | Open Data / ToS | [docs/data-sources/flights.md](./docs/data-sources/flights.md) |
| 2 | **Ships** | [AISStream](https://aisstream.io/) | Developer API Terms | [docs/data-sources/ships.md](./docs/data-sources/ships.md) |
| 3 | **Satellites** | [CelesTrak](https://celestrak.org/) · [Space-Track](https://www.space-track.org/) | Public Ephemeris | [docs/data-sources/satellites.md](./docs/data-sources/satellites.md) |
| 4 | **Earthquakes** | [USGS](https://earthquake.usgs.gov/) · [EMSC](https://www.emsc-csem.org/) | Public Domain / CC BY 4.0 | [docs/data-sources/quakes.md](./docs/data-sources/quakes.md) |
| 5 | **Wildfires** | [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/) | Public Domain | [docs/data-sources/fires.md](./docs/data-sources/fires.md) |
| 6 | **CCTV** | State & Municipal DOTs | Public Traffic Feeds | [docs/data-sources/cctv.md](./docs/data-sources/cctv.md) |
| 7 | **Radio** | [Radio Browser](https://www.radio-browser.info/) | Community Open API | [docs/data-sources/radio.md](./docs/data-sources/radio.md) |
| 8 | **Launches** | Flight Club / Public Telemetry | Reconstructed Models | [docs/data-sources/launches.md](./docs/data-sources/launches.md) |
| 9 | **Weather** | [RainViewer](https://www.rainviewer.com/) · [NOAA](https://www.weather.gov/) | Free API / Public Domain | [docs/data-sources/weather.md](./docs/data-sources/weather.md) |
| 10 | **GBFS** | Regional GBFS Municipal Feeds | Open Data | [docs/data-sources/gbfs.md](./docs/data-sources/gbfs.md) |
| 11 | **Overpass** | [OpenStreetMap](https://www.openstreetmap.org/) | ODbL 1.0 | [docs/data-sources/overpass.md](./docs/data-sources/overpass.md) |
| 12 | **Cables** | [TeleGeography](https://www.submarinecablemap.com/) | CC BY-NC-SA 4.0 (Download Pack) | [docs/data-sources/cables.md](./docs/data-sources/cables.md) |

---

## 3. Security & Rate Governance

- All outbound telemetry requests pass through `packages/security/pinned-fetch` with TLS IP pinning, SSRF mitigation, and mandatory timeouts.
- Server proxies enforce dynamic rate-limits, Redis caching, and Cost Governor TTL tiering.
