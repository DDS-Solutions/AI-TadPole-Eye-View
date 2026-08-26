# Global Radio Broadcasts — Data Source Provenance

**Layer:** Global Radio & Open ATC Audio  
**Package:** `packages/providers/src/radio.ts` · `apps/server/src/routes/radio.ts`  
**Upstream Providers:** [Radio Browser Community](https://www.radio-browser.info/) · Open ATC Audio Feeds  
**Layer Status:** Production Parity

---

## 1. Provenance & Attribution

- **Primary Source:** Community-driven directory of international radio streams and open aviation audio broadcasts.
- **Attribution Notice:** *"Radio stream directory curated by the Radio Browser Community (https://www.radio-browser.info)."*
- **Terms of Service:** Public domain / Community open data directory.

---

## 2. Ingestion & Catalog Health Policy

- **Catalog Health Policy:** Evaluates minimum 5/9 genre queries successful, min 375 active stations required before catalog update promotion.
- **Transport:** Audio stream proxy with TLS verification and chunked transfer decoding.
- **Response Schema:** Validated using Zod (`RadioCatalog` / `RadioStation` in `packages/contracts/src/radio.ts`).
- **Normalized Entity Fields:** `id`, `name`, `url`, `homepage`, `favicon`, `tags`, `country`, `state`, `language`, `votes`, `codec`, `bitrate_kbps`, `latitude`, `longitude`.

---

## 3. Cost Governor & Rate Limits

- **Catalog Cache:** 24-hour server TTL with background refresh job.
- **Audio Proxy:** Streaming pass-through with bandwidth metering.

---

## 4. Honest Data Labeling

- **Live Broadcasts:** Labeled as `LIVE AUDIO BROADCAST (STREAM)`.
- **Degraded Status:** Feeds undergoing reconnect backoff display `RECONNECTING / BUFFERING`.
