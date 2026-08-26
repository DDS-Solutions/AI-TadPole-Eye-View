# Flights Telemetry — Data Source Provenance

**Layer:** Flights & Commercial Aviation  
**Package:** `packages/providers/src/opensky.ts` · `apps/server/src/routes/flights.ts`  
**Upstream Providers:** [OpenSky Network](https://opensky-network.org/) (Primary) · [adsb.lol](https://adsb.lol/) (Keyless Fallback)  
**Layer Status:** Production Parity

---

## 1. Provenance & Attribution

- **Primary Source:** The OpenSky Network is a non-profit association providing open access to global air traffic tracking data based on crowdsourced ADS-B and Mode S receiver networks.
- **Attribution Notice:** *"Crowdsourced air traffic data provided by The OpenSky Network (https://opensky-network.org) and adsb.lol open telemetry network."*
- **Terms of Service:** OpenSky Network Open Data License / Non-commercial and educational research terms. Commercial tier requires dedicated API credentials.
- **Fallback Source:** adsb.lol provides community-aggregated, unfiltered ADS-B telemetry with no authentication required.

---

## 2. Telemetry Ingestion & Transformation

- **Transport:** HTTP polling via `security/pinned-fetch` with `AbortSignal.timeout(8000)`.
- **Response Schema:** Validated at the provider boundary using Zod (`FlightBatch` in `packages/contracts/src/flight.ts`).
- **Normalized Entity Fields:** `icao24`, `callsign`, `origin_country`, `latitude`, `longitude`, `baro_altitude_m`, `velocity_mps`, `true_track_deg`, `vertical_rate_mps`, `geo_altitude_m`, `squawk`, `on_ground`.

---

## 3. Cost Governor & Rate Limits

- **OpenSky Unauthenticated:** Max 400 requests / day (1 request every 10–15s).
- **Adaptive TTL Tiers:**
  - `TTL = 9s` when `X-Rate-Limit-Remaining` > 100
  - `TTL = 30s` when remaining 50–100
  - `TTL = 90s` when remaining 10–50
  - `TTL = 300s` when remaining < 10
- **HTTP 429 Cooldown:** Honors `Retry-After` header (bounded between 30s and 30m). During cooldown, serves stale cached data with `X-Stale: 1` header.

---

## 4. Honest Data Labeling

- **Live Mode:** Real-time Mode-S / ADS-B pings within 15 seconds labeled as `LIVE`.
- **Interpolated Trajectories:** Position extrapolation during rAF intervals between poll batches labeled as `INTERPOLATED (RECONSTRUCTED ESTIMATE)`.
- **Seed Fixture Mode:** Replay of pre-recorded flight frames (`fixtures/flights-opensky.json`) labeled as `SEED REPLAY (SIMULATED)`.
