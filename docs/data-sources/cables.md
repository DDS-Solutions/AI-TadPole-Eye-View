# Submarine Cables — Data Source Provenance & Download Pack Policy

**Layer:** Submarine Fiber-Optic Cables & Landing Stations  
**Package:** `packages/providers/src/cables.ts`  
**Upstream Provider:** [TeleGeography Submarine Cable Map](https://www.submarinecablemap.com/)  
**Layer Status:** Non-Commercial Optional Download Pack (PLAN.md §5 & §10)

---

## 1. Provenance & Attribution

- **Primary Source:** TeleGeography Global Submarine Cable Map data.
- **Attribution Notice:** *"Submarine cable routes and landing stations provided by TeleGeography (https://www.submarinecablemap.com)."*
- **Terms of Service:** **Creative Commons Attribution-NonCommercial-ShareAlike (CC BY-NC-SA 4.0)**.

---

## 2. Licensing Hygiene & Zero-Bundling Policy (PLAN.md §5)

- **Policy:** GEV v2 is MIT-licensed. To preserve commercial permissibility of the core repository, **NO non-commercial (NC) data is bundled into the git tree or distribution artifacts**.
- **Download Pack Pattern:** Cable vector geometries are downloaded on-demand by the operator at runtime using `CablePackLoader` or CLI script, requiring explicit runtime acknowledgment of TeleGeography's CC BY-NC-SA terms.
- **Airgap / Seed Mode:** Seed mode uses synthetic/procedural public landing coordinates with zero copyrighted NC geometry bundled.

---

## 3. Ingestion & Transformation

- **Transport:** On-demand HTTPS download via `pinned-fetch` with SHA-256 integrity verification.
- **Normalized Entity Fields:** `id`, `name`, `owners`, `rfs_year` (Ready For Service), `length_km`, `landing_points` (`name`, `latitude`, `longitude`), `coordinates` (MultiLineString).

---

## 4. Honest Data Labeling

- **Downloaded Pack:** Labeled as `TELEGEOGRAPHY SUBMARINE CABLE MAP (CC BY-NC-SA 4.0)`.
- **Synthetic Fallback:** Labeled as `SYNTHETIC LANDING POINTS (ESTIMATED)`.
