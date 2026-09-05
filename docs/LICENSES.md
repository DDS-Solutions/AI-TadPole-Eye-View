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
| Synthetic orbital seed elements | DDS-Solutions procedural fixture | MIT | Bundled synthetic records only; no real catalogue identifiers or names |
| Orbital GP/OMM elements | CelesTrak (basic SSA data originates with U.S. Space Force / 18 SDS via Space-Track.org) | CelesTrak usage guidelines; production confirmation required | Derived visualization only; production stays locked until written commercial-use confirmation or formal owner acceptance is recorded; no raw catalogue mirroring |
| Earthquakes | USGS / EMSC | Public Domain / CC BY 4.0 | U.S. Geological Survey |
| NASA FIRMS Hotspots | NASA EOSDIS | Public Domain | NASA open science data policy |
| Traffic CCTV Feeds | State DOTs (Caltrans, NYCDOT, TfL) | Public Safety Open Data | Public traffic observation only |
| Radio Station Directory | Radio Browser Community | Public Domain / Open API | Community-curated catalog |
| Weather Observations | RainViewer / NOAA NWS | Free API / Public Domain | Doppler reflectivity & station obs |
| GBFS Bikeshare Feeds | Regional Municipalities | Open Government License | Public dock availability |
| OpenStreetMap | OpenStreetMap Foundation | ODbL 1.0 | Requires attribution & share-alike |
| Synthetic Submarine Cables | DDS-Solutions procedural fixture | MIT | Bundled test fixture; explicitly synthetic |
| Licensed Submarine Cable Pack | TeleGeography | Operator-specific annual data license | **NOT BUNDLED** — no default manifest or public raw-data endpoint |

---

## 3. Non-Commercial Data Policy (PLAN.md §5)

To maintain commercial friendliness of the MIT codebase:
- **Zero Third-Party Cable Bundling:** No TeleGeography route or landing-point geometry is stored in Git or distributed in NPM packages.
- **Synthetic Default:** The checked-in cable fixture is procedurally authored and MIT-licensed.
- **Licensed Pack Loader:** An operator with appropriate rights may configure a server-owned, digest-pinned manifest. Callers cannot supply URLs, paths, hashes, or a boolean that purports to accept a license. See ADR 0036.

---

## 4. 3D Asset Attributions & Models

- **Tactical Aircraft Models (F-16, A320, General Aviation):** Low-poly procedural glTF meshes generated for high-performance Cesium rendering under CC0 / Public Domain.
- **MQ-9 Reaper UAV & Satellite Meshes:** Low-poly stylized procedural geometric models; explicitly licensed under MIT / CC0 for open commercial use without upstream copyright encumbrance.
