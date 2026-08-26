# Thermal Anomalies & Wildfires — Data Source Provenance

**Layer:** Thermal Hotspots & Wildfires  
**Package:** `packages/providers/src/firms.ts` · `apps/server/src/routes/firms.ts`  
**Upstream Provider:** [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/) (Fire Information for Resource Management System)  
**Layer Status:** Production Parity

---

## 1. Provenance & Attribution

- **Primary Source:** NASA FIRMS provides near-real-time thermal anomaly data from Moderate Resolution Imaging Spectroradiometer (MODIS) aboard Terra and Aqua satellites, and Visible Infrared Imaging Radiometer Suite (VIIRS) aboard Suomi NPP and NOAA-20/21.
- **Attribution Notice:** *"NASA Near Real-Time and Fire Information for Resource Management System (FIRMS) (https://firms.modaps.eosdis.nasa.gov)."*
- **Terms of Service:** Public domain NASA open data policy.

---

## 2. Ingestion & Transformation

- **Transport:** CSV stream parsing via BullMQ job queue or server proxy with pinned-fetch.
- **Response Schema:** Validated using Zod (`ThermalHotspotBatch` in `packages/contracts/src/firms.ts`).
- **Normalized Entity Fields:** `id`, `latitude`, `longitude`, `brightness_kelvin`, `frp_mw` (Fire Radiative Power in Megawatts), `confidence`, `satellite` (MODIS/VIIRS), `acq_date`, `acq_time`, `daynight`.

---

## 3. Cost Governor & Rate Limits

- **Rate Limits:** Ingested in 3-hour or 24-hour regional batch chunks.
- **Server Cache:** Cached server-side with 1800s (30 min) TTL.

---

## 4. Honest Data Labeling

- **Satellite Remote Sensing:** Hotspots represent orbital infrared detections of radiant heat, labeled as `SATELLITE THERMAL ANOMALY`.
- **Caveats:** Reflected sunlight, volcanic activity, or industrial gas flares may trigger anomalies; confidence score (0–100%) and FRP (MW) are explicitly surfaced in HUD telemetry.
