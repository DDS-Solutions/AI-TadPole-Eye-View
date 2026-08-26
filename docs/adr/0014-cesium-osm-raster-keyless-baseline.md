# ADR 0014: CesiumJS with Ion-Free OSM Raster Imagery as Keyless Default Baseline

**Status:** Accepted · **Date:** 2026-08-26 · **Deciders:** Architecture Review

---

## Context & Problem Statement

PLAN.md mandates keyless boot defaults (Rule 3) and single-home imperative rendering (Rule 1). Previous revisions considered dual rendering pipelines (MapLibre 2D alongside Cesium 3D with PMTiles). Introducing multiple rendering engines before establishing the first telemetry layer duplicates rendering surface, fragments coordinate transformations, and introduces complex PMTiles Cesium adapters prematurely.

## Decision

1. **Cesium-First:** Standardize exclusively on CesiumJS (`@cesium/engine`) for 3D globe rendering.
2. **Ion-Free Keyless Baseline:** Initialize Cesium Viewer with `OpenStreetMapImageryProvider` (or standard OSM raster tile template) with ion assets explicitly disabled and OpenStreetMap attribution displayed.
3. **Defer MapLibre:** MapLibre is deferred to the airgap / offline milestone where lightweight 2D rendering delivers distinct operational value.

## Consequences

- **Positive:** Zero API tokens required for dev, test, and CI boot.
- **Positive:** Single authoritative rendering package (`@gev/cesium-kit`).
- **Negative:** Full vector tile styling is deferred until the airgap milestone.
