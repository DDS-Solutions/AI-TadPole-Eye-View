# Micromobility & Shared Transit — Data Source Provenance

**Layer:** GBFS Shared Micromobility (Bikes & Scooters)  
**Package:** `packages/providers/src/gbfs.ts` · `apps/server/src/routes/gbfs.ts`  
**Upstream Providers:** [NABSA GBFS Open Feeds](https://github.com/NABSA/gbfs) (Citi Bike NYC, Santander Cycles, etc.)  
**Layer Status:** Production Parity

---

## 1. Provenance & Attribution

- **Primary Source:** General Bikeshare Feed Specification (GBFS) standardized JSON endpoints published by participating municipal operators.
- **Attribution Notice:** *"Micromobility station and dock availability data from regional GBFS open feeds."*
- **Terms of Service:** Open data / Open Government License.

---

## 2. Ingestion & Transformation

- **Transport:** HTTP JSON polling with `pinned-fetch`.
- **Response Schema:** Validated using Zod (`BikeStationBatch` / `BikeStation` in `packages/contracts/src/gbfs.ts`).
- **Normalized Entity Fields:** `station_id`, `name`, `latitude`, `longitude`, `num_bikes_available`, `num_ebikes_available`, `num_docks_available`, `is_installed`, `is_renting`.

---

## 3. Cost Governor & Rate Limits

- **Update Frequency:** Polled at 60s intervals.
- **Server Cache:** Cached server-side with 60s TTL.

---

## 4. Honest Data Labeling

- **Live Dock Availability:** Labeled as `LIVE GBFS DOCK STATUS`.
- **GBFS v3 Compliance:** Handles both string and localized object names natively without `[object Object]` bugs.
