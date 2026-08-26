# Space Launch Replays — Data Source Provenance

**Layer:** Rocket Launches & Orbital Insertion Trajectories  
**Package:** `packages/providers/src/launches.ts` · `apps/server/src/routes/launches.ts`  
**Upstream Providers:** Flight Club / Public Launch Trajectory Models  
**Layer Status:** Production Parity

---

## 1. Provenance & Attribution

- **Primary Source:** Public trajectory simulations and launch telemetry modeled from public flight profiles (SpaceX, NASA, Rocket Lab, ESA).
- **Attribution Notice:** *"Launch trajectories modeled from public spaceflight flight profiles and mission reports."*
- **Terms of Service:** Educational spaceflight trajectory data.

---

## 2. Ingestion & Transformation

- **Transport:** Server telemetry proxy with cached mission JSON catalogs.
- **Response Schema:** Validated using Zod (`LaunchCatalog` / `LaunchMission` in `packages/contracts/src/launches.ts`).
- **Normalized Entity Fields:** `id`, `name`, `operator`, `vehicle`, `launch_site`, `target_orbit`, `launch_timestamp_ms`, `stages` (`stage_number`, `engine_type`, `thrust_kn`), `trajectory` (3D points with time offset, altitude, velocity, downrange distance).

---

## 3. Cost Governor & Rate Limits

- **Static Cache:** Mission catalogs cached with 12-hour TTL.

---

## 4. Honest Data Labeling

- **Modeled Simulation:** Trajectory curves represent mathematical flight profile simulations, labeled prominently as `MODELED TRAJECTORY (RECONSTRUCTED ESTIMATE)`.
- **Live Launch Window:** Real-time countdowns synchronized with sim-clock.
