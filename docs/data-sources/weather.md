# Weather & Precipitation Radar — Data Source Provenance

**Layer:** Weather Radar & Meteorological Stations  
**Package:** `packages/providers/src/weather.ts` · `apps/server/src/routes/weather.ts`  
**Upstream Providers:** [RainViewer](https://www.rainviewer.com/) · [NOAA NWS](https://www.weather.gov/)  
**Layer Status:** Production Parity

---

## 1. Provenance & Attribution

- **Primary Sources:** RainViewer Global Weather Radar API and NOAA National Weather Service observation stations.
- **Attribution Notice:** *"Global precipitation radar data provided by RainViewer (https://www.rainviewer.com) and NOAA National Weather Service."*
- **Terms of Service:** Free tier with rate-limit compliance / Public Domain (NOAA).

---

## 2. Ingestion & Transformation

- **Transport:** HTTP JSON & Tile proxying via `pinned-fetch`.
- **Response Schema:** Validated using Zod (`WeatherCollection` / `WeatherStation` in `packages/contracts/src/weather.ts`).
- **Normalized Entity Fields:** `id`, `name`, `latitude`, `longitude`, `temp_c`, `humidity_pct`, `pressure_hpa`, `wind_speed_mps`, `wind_dir_deg`, `condition`, `radar_timestamp`.

---

## 3. Cost Governor & Rate Limits

- **Radar Mosaic Update:** Updated every 10 minutes.
- **Cost Governor TTL:** Server caches station observations and radar frame timestamps for 300s (5m).

---

## 4. Honest Data Labeling

- **Doppler Composite:** Precipitation layers represent composite Doppler radar reflectivity (dBZ), labeled as `DOPPLER RADAR COMPOSITE`.
- **Surface Obs:** Meteorological stations labeled as `SURFACE WEATHER OBSERVATION`.
