# Satellites & Orbital Mechanics — Data Source Provenance

**Layer:** Satellites & Orbital Constellations  
**Package:** `packages/core/src/geoMath.ts` · `packages/cesium-kit/src/launchLayer.ts`  
**Upstream Providers:** [CelesTrak](https://celestrak.org/) · [Space-Track.org](https://www.space-track.org/)  
**Layer Status:** Production Parity

---

## 1. Provenance & Attribution

- **Primary Sources:** Two-Line Element (TLE) and General Perturbations (GP) orbital element sets curated by CelesTrak (Dr. T.S. Kelso) and 18th Space Defense Squadron (Space-Track.org).
- **Attribution Notice:** *"Orbital ephemeris data provided by CelesTrak (https://celestrak.org) and Space-Track.org."*
- **Terms of Service:** Public orbital elements published for spaceflight safety and academic use.

---

## 2. Ingestion & Orbital Mechanics Engine

- **Propagation Engine:** Pure mathematical SGP4/SDP4 algorithm wrapper (`satellite.js`) with Earth Gravitational Model 1996 (EGM96) geoid height corrections.
- **Sim-Clock Integration:** Computes true satellite sub-point (`latitude`, `longitude`, `altitude_km`) and orbital path geometry dynamically evaluated against injectable simulation time (`SimClock`).
- **Normalized Entity Fields:** `norad_id`, `name`, `intl_designator`, `inclination_deg`, `period_min`, `apogee_km`, `perigee_km`, `tle_line1`, `tle_line2`.

---

## 3. Cost Governor & Rate Limits

- **Catalog Refresh:** Daily TLE fetch cached on disk/Redis with 24-hour TTL.
- **Offline / Airgap:** Pre-bundled orbital catalogs for key constellations (ISS, Starlink, GPS, GLONASS, Galileo, Weather).

---

## 4. Honest Data Labeling

- **Mathematical Model:** Satellite coordinates are propagated mathematical predictions of orbital paths from empirical element sets, labeled as `PROPAGATED SGP4 EPHEMERIS`.
- **Decay Warning:** Objects with old TLE epochs (> 14 days) display `EPOCH DEGRADED` telemetry flags.
