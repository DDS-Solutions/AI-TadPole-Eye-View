# Seismic Events & Earthquakes — Data Source Provenance

**Layer:** Earthquakes & Seismic Activity  
**Package:** `packages/providers/src/usgs.ts` · `apps/server/src/routes/quakes.ts`  
**Upstream Providers:** [USGS Earthquake Hazards Program](https://earthquake.usgs.gov/) · [EMSC](https://www.emsc-csem.org/)  
**Layer Status:** Production Parity

---

## 1. Provenance & Attribution

- **Primary Source:** United States Geological Survey (USGS) Real-time Earthquake GeoJSON Feeds and European-Mediterranean Seismological Centre (EMSC).
- **Attribution Notice:** *"Seismic telemetry courtesy of the U.S. Geological Survey (USGS) and EMSC."*
- **Terms of Service:** Public domain (U.S. Government work) / CC BY 4.0 for EMSC data.

---

## 2. Ingestion & Transformation

- **Transport:** HTTP GeoJSON polling through `pinned-fetch` with mandatory timeout.
- **Response Schema:** Validated using Zod (`EarthquakeCollection` in `packages/contracts/src/quakes.ts`).
- **Normalized Entity Fields:** `id`, `place`, `magnitude`, `depth_km`, `time_ms`, `tsunami_alert`, `significance`, `coordinates` ([longitude, latitude, depth_km]).

---

## 3. Cost Governor & Rate Limits

- **Update Frequency:** Polled at 60s intervals for `all_hour.geojson` and 300s intervals for `all_day.geojson`.
- **Cost Governor TTL:** Server caches responses for 60s to prevent redundant upstream queries.

---

## 4. Honest Data Labeling

- **Reviewed Events:** USGS events with `status: 'reviewed'` labeled as `REVIEWED SEISMIC EVENT`.
- **Automatic Detections:** Events with `status: 'automatic'` labeled as `PRELIMINARY AUTOMATIC DETECTION`.
