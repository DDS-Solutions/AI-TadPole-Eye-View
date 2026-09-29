# ADR 0063 — USGS 3DEP Elevation Point Query Service adapter, vertical datums, unit conversions, and non-coercion invariants

**Status:** Accepted  
**Date:** 2026-09-27  
**Deciders:** Core Engineering Team  
**Consulted:** PLAN.md §2, §3, §8.2, §11.2, AGENTS.md, ADR 0035, ADR 0050, ADR 0052, ADR 0062  

---

## 1. Context

In PLAN.md §10 Task 11.2, Phase 11 (Economic R3: Risk, Resilience, and Accessibility) requires the implementation of the U.S. Geological Survey (USGS) 3D Elevation Program (3DEP) point elevation query capabilities via the modern Elevation Point Query Service (EPQS).

Specific requirements from PLAN.md §11.2 and the authorized 4-Pillar brief:
1. **Modern REST endpoint only**: EPQS v1/json REST endpoint (`https://epqs.nationalmap.gov/v1/json`). The legacy `pqs.php` endpoint is strictly prohibited and retired.
2. **Strict Non-Coercion Laws**:
   - The USGS EPQS service returns sentinel value `-1000000` (or `<= -999999`, or `null`) when a coordinate falls outside the DEM coverage area or into open ocean water bodies.
   - These sentinel values must **NEVER** be coerced to `0.0` sea level or treated as valid elevation measurements; they must evaluate to `{ status: 'unavailable', reason: '...' }` with `is_off_coverage: true`.
   - Legitimate below-sea-level land depressions (such as Badwater Basin in Death Valley, CA at -86 meters) and legitimate shoreline sea level benchmarks (0.0 meters) must remain valid and evaluate to `{ status: 'available' }` without coercion.
3. **Vertical & Horizontal Datums and Geoid Notice**:
   - Explicit vertical datum modeling (`NAVD88`, `NAD83`, `WGS84`, `local_mean_sea_level`, `unknown`).
   - Explicit horizontal datum modeling (`NAD83`, `WGS84`).
   - EPQS elevations are NAVD88 orthometric heights ($H$, height above geoid / mean sea level). Direct ingestion into Cesium WGS84 ellipsoidal 3D coordinates ($h$) requires local geoid undulation compensation ($h = H + N$, where $N \approx -20\text{m}$ to $-35\text{m}$ in CONUS) to prevent vertical registration errors.
   - Bidirectional pure conversion between meters and international feet (`1 foot = 0.3048 meters` exactly).
4. **Mandatory Advisory Screening Disclaimer**:
   - `USGS_3DEP_ADVISORY_DISCLAIMER`: clarifies that EPQS elevation data is provided for geospatial reference, preliminary screening, and terrain modeling, does not replace licensed land surveys or official FEMA Elevation Certificates for NFIP rating, and explicitly notes the NAVD88 orthometric datum requirement for Cesium integration.
5. **Operational Kill Switch & Seed Mode Enforcement**:
   - Kill switch `GEV_USGS_3DEP_ENABLED` failing closed with `Usgs3DepDisabledError`.
   - Seed mode is the default (`GEV_SEED_MODE=1`); live external calls require explicit developer authorization and use `pinnedFetch` with strict SSRF host/path allowlists.
6. **Performance Threshold**:
   - Query latency p95 < 25ms in seed mode (benchmarked at p50 ≈ 0.07ms, p95 ≈ 0.27ms via cached synthetic fixtures).

---

## 2. Decision

### 2.1 Contracts Layer (`packages/contracts/src/usgs3dep.ts`)
- **Constants**:
  - `USGS_3DEP_SCHEMA_VERSION = 1`
  - `USGS_3DEP_DEFAULT_VINTAGE = '3DEP 1/3 arc-second (2024)'`
  - `USGS_3DEP_MODERN_EPQS_URL = 'https://epqs.nationalmap.gov/v1/json'`
  - `USGS_3DEP_RETIRED_ENDPOINT_SUBSTRING = 'pqs.php'`
  - `USGS_EPQS_OFF_COVERAGE_SENTINEL = -1000000`
  - `USGS_3DEP_ADVISORY_DISCLAIMER`: attached to all elevation and slope results.
- **Schemas**:
  - `Usgs3DepVerticalDatumSchema`: `NAVD88`, `NAD83`, `WGS84`, `local_mean_sea_level`, `unknown`.
  - `Usgs3DepHorizontalDatumSchema`: `NAD83`, `WGS84`.
  - `Usgs3DepElevationUnitSchema`: `Meters`, `Feet`.
  - `RawUsgsEpqsResponseSchema`: wire parser for EPQS JSON format.
  - `Usgs3DepPointQuerySchema`: validated query with `x` [-180, 180], `y` [-90, 90], `units`.
  - `Usgs3DepBatchQuerySchema`: capped at 100 queries to prevent unbounded network or memory amplification.
  - `Usgs3DepElevationPointResultSchema`: includes point coordinates, `elevation`, `elevation_meters`, `elevation_feet` (discriminated `EconomicEstimate`), `vertical_datum`, `horizontal_datum`, `data_source`, `is_off_coverage`, and `DataProvenance`. SuperRefined with non-coercion invariants ensuring off-coverage points cannot have available status.
  - `Usgs3DepSlopeResultSchema`: terrain slope calculation between two coordinates with distance, elevation change, slope percent, slope degrees, and two-point provenance (`provenance_start`, `provenance_end`).
  - `Usgs3DepFixtureDatasetSchema`: validated synthetic seed fixture structure.

### 2.2 Pure Domain Layer (`packages/economic/src/usgs3depConversions.ts`)
- **Pure Unit Conversions**:
  - `metersToFeet(meters: number): number` (`meters / 0.3048`).
  - `feetToMeters(feet: number): number` (`feet * 0.3048`).
  - Round-trip invertibility property verified with `fast-check`.
  - `convertElevationEstimate`: converts units while preserving estimate status (`available` vs `unavailable`).
- **Validators & Non-Coercion Parser**:
  - `validateUsgsCoordinates(x, y)`: bounds checking.
  - `validateEpqsEndpoint(url)`: strictly throws if `pqs.php` is detected in URL pathname or query parameters.
  - `parseUsgsRawElevation(rawElev, rawUnits)`: maps numbers and EPQS sentinels to `ParsedUsgsElevation`. Values `<= -999999`, `null`, `undefined`, or `NaN` evaluate to `unavailable`. Legitimate negative values on land (e.g. -86m) evaluate to `available`. Discrete cutover locked at `-999998` (available) vs `-999999` (unavailable).
- **Terrain Slope Engine**:
  - `haversineDistanceMeters(lat1, lon1, lat2, lon2)`: spherical distance.
  - `USGS_3DEP_MIN_SLOPE_BASELINE_METERS = 10.0`: guards against DEM quantization noise over short baselines.
  - `calculateTerrainSlope(p1, p2)`: calculates horizontal distance, elevation change, slope percent, and degrees. Fails closed to `unavailable` if either point lacks valid elevation data or if horizontal distance is under the 10m minimum baseline.
- **Source Registry Integration (`packages/economic/src/sourceRegistry.ts`)**:
  - `usgs-3dep` status advanced from `planned` to `seed`.
  - `seed_fixture_id` linked to `usgs-3dep-synthetic-v1`.

### 2.3 Provider Adapter Layer (`packages/providers/src/usgs3dep.ts`)
- `Usgs3DepAdapter`:
  - `isEnabled()`: respects `GEV_USGS_3DEP_ENABLED !== '0'`.
  - `isSeedMode()`: defaults to true under `GEV_SEED_MODE !== '0'`.
  - `getElevation(query)`: single point elevation lookup.
  - `getElevations(queries)`: concurrent multi-point batch lookup.
  - `getSlope(p1, p2)`: terrain slope between coordinate endpoints.
  - **Seed Replay**: caches and queries `fixtures/usgs-3dep-synthetic-v1.json`, matching exact or nearest coordinates (< 0.2 deg) and returning deterministic `DataProvenance`. Unmapped coordinates evaluate to `unavailable` without failure.
  - **Live Pinned-Fetch**: strictly guards `epqs.nationalmap.gov` with host and path allowlists (`/v1/json`), 10-second timeout, and 1MB size limit. Rejects any attempt to query `pqs.php`.
  - **Errors**: `Usgs3DepDisabledError`, `Usgs3DepSeedModeViolationError`, `Usgs3DepRetiredEndpointError`, `Usgs3DepInvalidQueryError`.

---

## 3. Consequences

### Positive
- Fully governed, typed, and contract-validated elevation capability for GEV v2 and AI-Tadpole digital twin SMB users.
- Guaranteed protection against silent zero-coercion of ocean or missing elevation data.
- Absolute rejection of deprecated legacy `pqs.php` endpoints.
- Sub-millisecond seed-mode query performance satisfying PLAN.md §10 thresholds.
- Reusable terrain slope calculation for site risk and accessibility modeling (Tasks 11.3 and 11.4).

### Neutral / Follow-Up
- Task 11.3 will implement EPA AQS for environmental screening.
- Task 11.4 will implement DOT/BTS accessibility context and aggregate site-risk functions.
