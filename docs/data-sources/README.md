# Data Sources & Provenance Index

This directory documents the provenance, licensing terms, update cadence, and rate-limiting policies for all geospatial data layers in GEV v2.

---

## Provenance Policy & Ethos (PLAN.md §1.3, §5 & §8)

1. **Honest Data Labeling:** Estimated or simulated traffic must be labeled explicitly (`RECONSTRUCTED ESTIMATE`, `SIMULATED`, `LIVE STREAM`).
2. **License Hygiene:** No non-commercial (NC) data is bundled directly. ODbL sources are isolated with share-alike provisions noted.
3. **Layer Documentation:** Full provenance files exist per layer:

| Layer | Source | License / Terms | Provenance Spec |
|---|---|---|---|
| Flights | OpenSky Network | Seed implemented; OAuth2 live path has separate research/commercial terms gate | [flights.md](./flights.md) |
| Ships | AISStream | Seed implemented; server API key, bounded subscription, and developer terms required for live | [ships.md](./ships.md) |
| Satellites | CelesTrak standard GP (JSON/OMM) | MIT synthetic seed; live production remains terms-locked under ADR 0034 | [satellites.md](./satellites.md) |
| Earthquakes | USGS real-time GeoJSON | Seed implemented; U.S. Government source/citation policy | [quakes.md](./quakes.md) |
| Wildfires | NASA FIRMS | Seed implemented; MAP_KEY, product/geography approval, quota, attribution, and terms required for live | [fires.md](./fires.md) |
| CCTV | Source-specific state or municipal DOT | Seed implemented; the federal catalog is discovery only and each live agency needs its own approval | [cctv.md](./cctv.md) |
| Radio | Radio Browser directory plus source-specific station streams | Seed implemented; directory rights do not grant stream redistribution | [radio.md](./radio.md) |
| Launches | Reconstructed GEV seed; Launch Library 2 is a live candidate | Seed implemented; LL2 quota, terms, and fixture/redistribution rights remain separate | [launches.md](./launches.md) |
| Weather | RainViewer | Seed implemented; current public API is non-commercially scoped and production remains locked | [weather.md](./weather.md) |
| GBFS | Source-specific regional GBFS systems | Seed implemented; each feed's license fields, operator terms, geography, and version require review | [gbfs.md](./gbfs.md) |
| Overpass | OpenStreetMap Foundation | ODbL 1.0 | [overpass.md](./overpass.md) |
| Cables | GEV synthetic fixture / optional operator-licensed TeleGeography pack | MIT seed / operator-specific annual license | [cables.md](./cables.md) |
| Solar context | GEV pure-domain calculation; USNO/NOAA references | Planned/unavailable; no network or credentials | [solar-context.md](./solar-context.md) |
| NWS alerts | NOAA National Weather Service CAP API | Planned/unavailable; identifiable User-Agent and terms record required | [nws-alerts.md](./nws-alerts.md) |
| Aviation weather | NOAA Aviation Weather Center | Planned/unavailable; identifiable User-Agent and terms record required | [aviation-weather.md](./aviation-weather.md) |
| Tropical cyclones | NOAA NHC/CPHC GIS advisories | Planned/unavailable; fixed basin feeds and terms record required | [tropical-cyclones.md](./tropical-cyclones.md) |
| Coastal conditions | NOAA CO-OPS APIs | Planned/unavailable; application ID and terms record required | [coastal-conditions.md](./coastal-conditions.md) |
| Time-enabled radar | NOAA/NWS MRMS ImageServer | Planned/unavailable bounded spike; exact AOI/time/image caps apply | [nowcoast-radar.md](./nowcoast-radar.md) |
| Lightning | NOAA GOES-R GLM L2 LCFA | Planned/unavailable bounded spike; public buckets with strict granule/byte caps | [goes-glm.md](./goes-glm.md) |
