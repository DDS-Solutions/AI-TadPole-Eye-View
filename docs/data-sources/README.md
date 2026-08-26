# Data Sources & Provenance

This directory documents the provenance, licenses, rate limits, and attribution requirements for all geospatial data layers in GEV v2.

---

## Provenance Policy

Per PLAN.md §5 and §8:
1. **Honest Data Labeling:** Estimated or simulated traffic must be labeled explicitly (`RECONSTRUCTED ESTIMATE`, `SIMULATED`).
2. **License Hygiene:** No non-commercial (NC) data is bundled directly. ODbL sources are isolated in dedicated packages with share-alike provisions noted.
3. **Layer Documentation:** Full adapter documentation and upstream source terms land with each respective provider adapter package in `packages/providers/`.

| Layer | Source | License / Terms | Status |
|---|---|---|---|
| Flights | OpenSky Network · adsb.lol | OpenSky ToS / Open Data | Phase 0/1 Proof Feed |
| Ships | AISStream | Developer API Terms | Planned |
| Satellites | Space-Track / CelesTrak | Public Orbital Data | Planned |
| Earthquakes | USGS · EMSC | Public Domain / CC BY 4.0 | Planned |
| Fires | NASA FIRMS | Public Domain | Planned |
| CCTV | Server-registered feeds | Public Stream URLs | Planned |
| Radio | Radio Browser Community | Community Open API | Planned |
