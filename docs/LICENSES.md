# LICENSES.md — Software, Data & Asset Licenses

This document outlines the software licenses, open data terms, and 3D asset attributions across God's Eye View v2 (GEV).

---

## 1. Software Codebase License

- **Core Monorepo:** [MIT License](./LICENSE)
- **Copyright:** (c) 2026 DDS-Solutions

---

## 2. Geospatial Data Licensing & Attribution

| Dataset | Provider | License | Terms / Attribution Summary |
|---|---|---|---|
| OpenSky Flight Data | OpenSky Network | Open Data / Research | Non-commercial research / OpenSky ToS |
| AIS Vessel Telemetry | AISStream | Developer API Terms | API token required for live feed |
| Orbital TLEs | CelesTrak / Space-Track | Public Domain / Open | Free for tracking & educational use |
| Earthquakes | USGS / EMSC | Public Domain / CC BY 4.0 | U.S. Geological Survey |
| NASA FIRMS Hotspots | NASA EOSDIS | Public Domain | NASA open science data policy |
| Traffic CCTV Feeds | State DOTs (Caltrans, NYCDOT, TfL) | Public Safety Open Data | Public traffic observation only |
| Radio Station Directory | Radio Browser Community | Public Domain / Open API | Community-curated catalog |
| Weather Observations | RainViewer / NOAA NWS | Free API / Public Domain | Doppler reflectivity & station obs |
| GBFS Bikeshare Feeds | Regional Municipalities | Open Government License | Public dock availability |
| OpenStreetMap | OpenStreetMap Foundation | ODbL 1.0 | Requires attribution & share-alike |
| Submarine Cables | TeleGeography | **CC BY-NC-SA 4.0** | **NOT BUNDLED** — Optional download pack |

---

## 3. Non-Commercial Data Policy (PLAN.md §5)

To maintain commercial friendliness of the MIT codebase:
- **Zero NC Bundling:** No Non-Commercial (NC) datasets (e.g. TeleGeography cable geometries) are stored in the Git repository or distributed within NPM packages.
- **Download Pack Loader:** Operators can download NC datasets at runtime via `packages/providers/src/cables.ts` by explicitly accepting the provider's license terms (`licenseAccepted: true`).

---

## 4. 3D Asset Attributions & Models

- **Tactical Aircraft Models (F-16, A320, General Aviation):** Low-poly procedural glTF meshes generated for high-performance Cesium rendering under CC0 / Public Domain.
- **MQ-9 Reaper UAV & Satellite Meshes:** Low-poly stylized procedural geometric models; explicitly licensed under MIT / CC0 for open commercial use without upstream copyright encumbrance.
