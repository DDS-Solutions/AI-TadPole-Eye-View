# ADR 0057 — OpenStreetMap commercial enrichment adapter, boundary contracts, sanitizer integration, ODbL attribution, and seed pipeline

**Status:** Accepted  
**Date:** 2026-09-21  
**Deciders:** Core Engineering Team  
**Consulted:** PLAN.md §2, §3, §8.2, §9.3, §10 Task 9.3, OQ-5, AGENTS.md, ADR 0021, ADR 0035, ADR 0050, ADR 0052, ADR 0054  

---

## 1. Context

In PLAN.md §10 Task 9.3, Phase 9 (Economic R1: Market and Business Footprint) requires adding OpenStreetMap (OSM) commercial enrichment through the existing Overpass sanitizer, pinned-fetch, and cache path with attribution and extraction limits, resolving **OQ-5**.

Specific requirements from PLAN.md §8.2, §9.3, and the authorized 4-Pillar brief:
1. **OQ-5 Resolution & Output Classification:** Approved OSM use and classification under the Open Database License (ODbL) 1.0. Commercial POI extraction and density aggregation for SMB digital twin market footprints constitute a factual **Collective Database** under ODbL §1.0. Raw OSM geometries are neither altered nor relicensed.
2. **Mandatory ODbL Attribution Notice:** Every commercial enrichment response and evidence record carries explicit attribution: `© OpenStreetMap contributors (ODbL 1.0)` with a link to `https://www.openstreetmap.org/copyright` and legal disclaimer `OSM_ODBL_LEGAL_DISCLAIMER`. Responses lacking valid attribution fail closed immediately.
3. **Extraction Bounds & Tag Whitelisting:** Extraction is bounded: maximum bounding box span of $0.5^\circ$ (~35 km), 25s execution timeout cap, polite rate limiting (minimum 1,000ms interval between upstream queries), and strict tag whitelisting (`amenity`, `shop`, `craft`, `office`, `commercial`, `tourism`, `healthcare`). Arbitrary unwhitelisted Overpass QL execution is rejected.
4. **Sanitizer & Pinned-Fetch Integration:** All queries pass through `sanitizeOverpassQuery` in `packages/security`, preventing ReDoS, excessive statements, and unbounded queries. Live queries execute through `pinnedFetch` with TLS pinning and host allowlists (`overpass-api.de`, `overpass.kumi.systems`).
5. **Deterministic Seed Mode Default:** Under `GEV_SEED_MODE=1`, zero live network calls occur; verified synthetic fixtures (`fixtures/osm-commercial-synthetic-v1.json`, `fixtures/osm-commercial-evidence-synthetic-v1.json`) are served deterministically. Live calls require explicit developer authorization.
6. **Content/Instruction Separation:** Crowdsourced POI names, operator strings, and tags are untrusted third-party content. They are sandboxed inside `<untrusted_data_block>` nonces via ADR 0054 prompt protection before exposure to downstream LLM or Tadpole contexts.
7. **Performance Threshold:** Pure domain parsing, feature extraction, and in-memory cache queries execute in $< 10\text{ms}$ p95.

---

## 2. Decision

### 2.1 Contracts Layer (`packages/contracts/src/osmCommercial.ts`)
- Defined ODbL constants: `OSM_ODBL_LICENSE_ID` (`odbl-1.0`), `OSM_ODBL_LICENSE_NAME` (`Open Database License (ODbL) 1.0`), `OSM_ODBL_ATTRIBUTION` (`© OpenStreetMap contributors (ODbL 1.0)`), and `OSM_ODBL_LEGAL_DISCLAIMER`.
- Defined extraction bounds: `OSM_COMMERCIAL_MAX_BBOX_SPAN_DEG` ($0.5^\circ$), `OSM_COMMERCIAL_MAX_TIMEOUT_SEC` (25s), `OSM_COMMERCIAL_MAX_ELEMENTS` (5000), `OSM_COMMERCIAL_MIN_REQUEST_INTERVAL_MS` (1000ms), `OSM_COMMERCIAL_CACHE_TTL_SEC` (86400s).
- Defined strongly-typed Zod schemas:
  - `OsmCommercialCategorySchema`: `food_and_beverage`, `retail`, `services`, `office`, `craft_industrial`, `healthcare`, `hospitality`, `other_commercial`.
  - `OsmCommercialBoundingBoxSchema`: validates finite coordinate bounds and enforces maximum $0.5^\circ$ span limit.
  - `OsmCommercialQuerySchema`: validated query envelope (bbox, optional categories, optional search term).
  - `OsmCommercialPoiFeatureSchema`: normalized commercial point of interest (id, type, lat, lon, name, category, primary_tag, tags, brand, operator, opening_hours, cuisine).
  - `OsmCommercialFootprintSummarySchema`: total features, category counts, density per km², area in km², and top amenities.
  - `OsmCommercialEnrichmentResponseSchema`: complete response envelope with fail-closed superRefine checking for mandatory OpenStreetMap attribution and ODbL license identifier.

### 2.2 Security Layer (`packages/security/src/osmCommercialSanitizer.ts`)
- Implemented `validateOsmCommercialBoundingBox` verifying coordinates and enforcing $\le 0.5^\circ$ span limits.
- Implemented `buildSanitizedOsmCommercialOverpassQuery`: builds deterministic, targeted Overpass QL statements for requested whitelisted categories, runs through `sanitizeOverpassQuery` for timeout clamping, statement count validation, and ReDoS protection.
- Implemented `assertOsmCommercialQueryWhitelisted`: ensures Overpass QL strings only target whitelisted commercial primary keys and rejects arbitrary QL execution (e.g. power grids, military bases, administrative boundaries).

### 2.3 Pure Domain Engine (`packages/economic/src/osmCommercialCategorizer.ts`)
- Implemented pure, zero-I/O domain functions (adhering to ADR 0052):
  - `categorizeOsmTags`: normalizes raw OSM tags into one of 8 commercial categories with primary tag identification.
  - `extractCommercialFeatures`: extracts typed `OsmCommercialPoiFeature[]` from raw elements, safely handling both nodes and ways with center coordinates.
  - `calculateBoundingBoxAreaKm2`: spherical surface area calculation for bounding boxes.
  - `calculateOsmCommercialSummary`: computes totals, category breakdowns, density per km², and sorted top amenities.
  - `generateOsmCommercialEvidenceRecords`: produces structured `EconomicEvidenceRecord[]` with `source_id: 'osm-commercial'` and valid identifiers.
  - `sanitizeOsmFeatureForPromptContext`: wraps untrusted crowdsourced attributes in delimiter-sandboxed data blocks using ADR 0054 nonces.
  - `assertOsmTextSafeForInstruction`: detects and rejects unescaped prompt injection payloads in instruction contexts.

### 2.4 Provider Adapter Layer (`packages/providers/src/osmCommercial.ts`)
- Implemented `OsmCommercialAdapter`:
  - Provider identity: `OSM_COMMERCIAL_PROVIDER_ID = 'osm-commercial'`, `OSM_COMMERCIAL_FEED_ID = 'overpass-commercial-poi'`.
  - Kill-switch via `GEV_OSM_COMMERCIAL_ENABLED !== '0'`, throwing `OsmCommercialProviderDisabledError`.
  - Default seed mode (`GEV_SEED_MODE=1` or `seedMode=true`) loading `fixtures/osm-commercial-synthetic-v1.json` with zero network egress.
  - Live mode routing through `buildSanitizedOsmCommercialOverpassQuery`, `pinnedFetch` to `https://overpass-api.de/api/interpreter`, request rate limiter, and in-memory cache (TTL 86400s).
  - High performance: in-memory indexed query and extraction $< 0.05\text{ms}$ p95 (sub-millisecond, far exceeding the $< 10\text{ms}$ budget).
  - Convenience query methods: `queryCommercialEnrichment`, `getCommercialEvidence`, `getFeaturesByCategory`, and `getCommercialSummary`.

---

## 3. Consequences

### Positive
- Formal resolution of OQ-5: lawful, governed use of OpenStreetMap data with strict ODbL 1.0 attribution and collective database classification.
- Extraction caps prevent upstream server abuse, excessive memory consumption, and unbounded queries.
- Pure domain categorization and metric computation execute in $< 0.05\text{ms}$ p95 with zero I/O.
- Untrusted crowdsourced text is sanitized and sandboxed against prompt injection before entering AI contexts.
- Strict seed mode and kill switches protect against unauthorized third-party network egress.

### Negative / Trade-offs
- Queries spanning $> 0.5^\circ$ (~35 km) are rejected and must be partitioned into tiled sub-AOIs.
- Non-whitelisted OSM tags (e.g. residential buildings, power infrastructure) are excluded from extraction.

---

## 4. Compliance & Verification Gate

1. `packages/contracts/test/osmCommercialContracts.test.ts`: 7/7 tests verifying schema validation, bounding box limits, mandatory ODbL attribution, and disclaimers.
2. `packages/security/test/osmCommercialSanitizer.test.ts`: 5/5 tests covering query building, bounding box limits, tag whitelisting, ReDoS defense, and fast-check property testing.
3. `packages/economic/test/osmCommercialCategorizer.test.ts`: 8/8 tests covering categorization, density calculation, evidence generation, prompt protection, and property tests.
4. `packages/providers/test/osmCommercial.test.ts`: 11/11 tests covering ingestion, spatial filtering, category filtering, evidence generation, seed-mode network denial, kill-switch, and 100-iteration performance benchmark (p95 = 0.038ms).
5. All source files strictly $\le 500$ lines.
