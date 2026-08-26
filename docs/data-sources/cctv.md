# Public CCTV Feeds — Data Source Provenance

**Layer:** Public CCTV & Traffic Cameras  
**Package:** `packages/providers/src/cctv.ts` · `apps/server/src/routes/cctv.ts`  
**Upstream Providers:** Official State DOT Feeds (Caltrans, NYCDOT, TfL, etc.)  
**Layer Status:** Production Parity

---

## 1. Provenance & Attribution

- **Primary Source:** Publicly accessible municipal and state Department of Transportation (DOT) traffic camera feeds.
- **Attribution Notice:** *"Traffic camera video and image streams provided by regional departments of transportation (Caltrans QuickMap, NYC DOT, Transport for London)."*
- **Terms of Service:** Public safety and open traffic monitoring terms. No private/restricted streams are indexed.

---

## 2. Ingestion & Security Lifecycle

- **Transport:** Server-side proxy with strict SSRF-guarded `pinned-fetch`, mandatory connect timeout (4s), idle stream timeout (15s), and absolute stream lifetime ceiling (30m).
- **Supported Formats:** HLS (`.m3u8` via `hls.js`), MPEG-TS (`.ts` via `mpegts.js`), and periodic JPEG snapshot polling.
- **Response Schema:** Validated using Zod (`CctvCatalog` / `CctvCamera` in `packages/contracts/src/cctv.ts`).
- **Normalized Entity Fields:** `id`, `name`, `agency`, `latitude`, `longitude`, `stream_url`, `snapshot_url`, `is_ptz`, `format`.

---

## 3. Cost Governor & Rate Limits

- **Connection Throttling:** Client streams route through Hono streaming proxy; upstream hosts restricted to allowlisted DOT domains.
- **Circuit Breaker:** 3 consecutive proxy timeouts trip the stream health flag to `UNAVAILABLE` for 10 minutes.

---

## 4. Honest Data Labeling & Ethics Guardrails

- **Ethics Posture (PLAN.md §12):** Traffic monitoring only. **Zero face-recognition, license-plate recognition (ALPR), or automated person-tracking is permitted.**
- **Telemetry Label:** Labeled as `PUBLIC TRAFFIC CAMERA (LIVE STREAM / SNAPSHOT)`.
