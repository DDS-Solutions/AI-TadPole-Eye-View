# OpenStreetMap & Overpass QL — Data Source Provenance

**Layer:** OpenStreetMap Spatial Features & Infrastructure  
**Package:** `packages/security/src/overpassSanitizer.ts` · `apps/server/src/routes/overpass.ts`  
**Upstream Provider:** [OpenStreetMap Foundation](https://www.openstreetmap.org/) / Overpass API  
**Layer Status:** Production Parity

---

## 1. Provenance & Attribution

- **Primary Source:** OpenStreetMap community-contributed vector geographic database queried via Overpass QL.
- **Attribution Notice:** *"© OpenStreetMap contributors (ODbL License — https://www.openstreetmap.org/copyright)."*
- **Terms of Service:** Open Database License (ODbL) 1.0. Derivative works must attribute contributors and share under ODbL.

---

## 2. Ingestion & Overpass QL Sanitizer

- **Sanitization Engine:** Strict single-pass lexer blanking quoted literals and comments, tag-filter stripping, spatial-bounds probing, `poly:` and control-flow rejection, `[timeout:]` clamping (max 25s), radius/bbox caps (max 0.25 deg²), response body byte caps (max 10MB).
- **Transport:** HTTP POST proxy with `pinned-fetch`.

---

## 3. Cost Governor & Rate Limits

- **Rate Limits:** Shared public Overpass server slots (max 2 concurrent slots).
- **Server Cache:** Spatial query results cached with 3600s (1h) TTL.

---

## 4. Honest Data Labeling

- **Crowdsourced Data:** Labeled as `OPENSTREETMAP VECTOR GEOMETRY (ODbL)`.
