# Maritime & Vessel Telemetry — Data Source Provenance

**Layer:** Ships & Maritime Traffic  
**Package:** `packages/providers/src/ais.ts` · `apps/server/src/routes/ships.ts`  
**Upstream Provider:** [AISStream](https://aisstream.io/)  
**Layer Status:** Production Parity

---

## 1. Provenance & Attribution

- **Primary Source:** AISStream provides real-time global maritime Automatic Identification System (AIS) messages via a managed WebSocket API.
- **Attribution Notice:** *"Live vessel positions and metadata provided by AISStream (https://aisstream.io)."*
- **Terms of Service:** AISStream developer API terms of service. Free API key required for live connection; keyless boot supported via deterministic seed fixtures.

---

## 2. Telemetry Ingestion & Transformation

- **Transport:** Persistent WebSocket connection with `aisWatchdog` automatic reconnection and heartbeat ping intervals (30s).
- **Response Schema:** Validated at the provider boundary using Zod (`ShipBatch` / `ShipState` in `packages/contracts/src/marine.ts`).
- **Normalized Entity Fields:** `mmsi`, `name`, `ship_type`, `latitude`, `longitude`, `sog_knots` (Speed Over Ground), `cog_deg` (Course Over Ground), `heading_deg`, `destination`, `eta`, `callsign`, `dim_bow_m`, `dim_stern_m`.

---

## 3. Cost Governor & Rate Limits

- **Connection Limits:** 1 concurrent WebSocket connection per API key.
- **Server Cache:** In-memory spatial grid and MMSI deduplication table.
- **Staleness Policy:** Vessels without a position report within 1800s (30m) are pruned from active scene rendering.

---

## 4. Honest Data Labeling

- **Live Stream:** Real-time AIS position reports received over WebSocket labeled as `LIVE AIS`.
- **Dead Reckoning:** Positions estimated between periodic AIS broadcasts (every 2–10s when underway, 3m when anchored) labeled as `ESTIMATED TRACK`.
- **Seed Fixture Mode:** Replayed vessel traffic (`fixtures/ships-ais.json`) labeled as `SEED REPLAY (SIMULATED)`.
