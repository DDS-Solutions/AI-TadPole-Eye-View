# Data Sources & Provenance Index

This directory documents the provenance, licensing terms, update cadence, and rate-limiting policies for all geospatial data layers in GEV v2.

---

## Provenance Policy & Ethos (PLAN.md §1.3, §5 & §8)

1. **Honest Data Labeling:** Estimated or simulated traffic must be labeled explicitly (`RECONSTRUCTED ESTIMATE`, `SIMULATED`, `LIVE STREAM`).
2. **License Hygiene:** No non-commercial (NC) data is bundled directly. ODbL sources are isolated with share-alike provisions noted.
3. **Layer Documentation:** Full provenance files exist per layer:

| Layer | Source | License / Terms | Provenance Spec |
|---|---|---|---|
| Flights | OpenSky Network · adsb.lol | Open Data / CC BY 4.0 | [flights.md](./flights.md) |
| Ships | AISStream | Developer API Terms | [ships.md](./ships.md) |
| Satellites | CelesTrak standard GP (JSON/OMM) | MIT synthetic seed / CelesTrak usage guidelines (terms approval required) | [satellites.md](./satellites.md) |
| Earthquakes | USGS · EMSC | Public Domain / CC BY 4.0 | [quakes.md](./quakes.md) |
| Wildfires | NASA FIRMS | Public Domain | [fires.md](./fires.md) |
| CCTV | State DOT Feeds | Public Traffic Feeds | [cctv.md](./cctv.md) |
| Radio | Radio Browser Community | Community Open Directory | [radio.md](./radio.md) |
| Launches | Flight Club / Public Models | Modeled Reconstructions | [launches.md](./launches.md) |
| Weather | RainViewer · NOAA | Free Tier / Public Domain | [weather.md](./weather.md) |
| GBFS | NABSA GBFS Open Feeds | Open Data | [gbfs.md](./gbfs.md) |
| Overpass | OpenStreetMap Foundation | ODbL 1.0 | [overpass.md](./overpass.md) |
| Cables | GEV synthetic fixture / optional operator-licensed TeleGeography pack | MIT seed / operator-specific annual license | [cables.md](./cables.md) |
