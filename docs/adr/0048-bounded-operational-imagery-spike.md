# ADR 0048: Bounded operational-imagery spike

- **Status:** Accepted
- **Date:** 2026-09-06
- **Task:** PLAN.md 5.3.4
- **Extends:** [ADR 0045](./0045-operational-awareness-source-and-access-policy.md),
  [ADR 0046](./0046-operational-awareness-rendering-and-architecture-baseline.md)

## Context

ADR 0045 admits the NWS time-enabled MRMS base-reflectivity ImageServer and NOAA GOES-18/19
`GLM-L2-LCFA` products only as bounded spike candidates. Task 5.3.4 requires current first-party
re-verification and one development-only measurement trial before either candidate may move from
`planned`/`unavailable` to `implemented`. A missed or unmeasurable payload, decode, memory,
playback, or Cesium gate keeps that candidate unavailable.

First-party material was rechecked on 2026-09-06. The fixed NWS ImageServer still identifies the
MRMS base-reflectivity product, UTC `idp_validtime`/`idp_validendtime` fields, time-enabled ArcGIS
export and WMS 1.3.0 operations, five-minute updates, and NOAA/NWS copyright text. Its narrative
advertises a moving four-hour window, but its live `timeInfo.timeExtent` measured only 120.6
minutes during the trial. Consumers therefore cannot assume four hours and must derive every
selectable source time from current service metadata. The NWS appropriate-use policy still calls
for requests aligned with source refresh and restrained retry behavior.

The NCEI dataset record still identifies `GLM-L2-LCFA`, 20-second files, flash/group/event
relationships, NetCDF4 distribution, DOI `10.7289/V5KH0KK6`, and source-specific quality and
liability notices. The current AWS Open Data registry lists the unauthenticated `noaa-goes18` and
`noaa-goes19` buckets. NOAA OSPO identifies GOES-18 as operational West and GOES-19 as
operational East. The GOES-R Product Definition and User's Guide states that this product is
NetCDF4/HDF5 and does not conform to the classic NetCDF data model because it uses multiple
unlimited dimensions.

## Measurement method and fixed bounds

The versioned [`measure-operational-imagery-spike.mjs`](../../scripts/measure-operational-imagery-spike.mjs)
harness requires an authoritative connected GEV server, refuses STASIS, confirms that the server
remains in seed mode, and sends external requests only through `pinnedFetch`. It fixes the exact
hosts and path prefixes, validates every resolved public IP, refuses redirects, uses a 15-second
timeout, enforces response byte ceilings, and holds source concurrency to two. Node's low-level
DNS resolver was refused by the development host; the harness used its supported custom-resolver
boundary with the operating system's complete address set while retaining public-IP validation and
TLS hostname verification.

The named trial `bounded-official-sample-v1` ran with authoritative shared-SQLite governance at
state revision 31, STASIS inactive, seed server mode, and USD 9.9837 budget remaining. No source
payload was written to the repository or promoted to a fixture. The exact request set and
aggregated measurements are preserved in
[`bounded-official-sample-v1.json`](../../execution/task-5.3.4/bounded-official-sample-v1.json).

### NWS MRMS ImageServer result

- Requests: one 256 KiB-bounded metadata read and one export; two total and sequential.
- Normalized AOI: longitude `[-100, -90]`, latitude `[30, 40]`; output `1024 × 1024` PNG32.
- Selected source time: `2026-09-06T20:58:58.000Z`; advertised live extent
  `2026-09-06T18:58:22.000Z` through `2026-09-06T20:58:58.000Z` (120.6 minutes).
- Payload: 4,144 bytes; server cache control `max-age=43200`; no second upstream request on
  in-memory replay.
- Metadata/export fetch p50 2,599.431 ms, p95/max 7,274.241 ms. The export stayed under the
  15-second timeout and 4 MiB ceiling.
- Export fetch peak process deltas were 0 bytes measured heap and 16,384 bytes RSS. Negative final
  deltas caused by collection are not treated as memory savings.
- The PNG signature and dimensions validated, but full browser image decode, bounded multi-slice
  playback, main-thread Cesium imagery ingestion/update p95, and steady-frame p95 were not
  measured. One authorized live slice cannot establish a time-series playback result by itself.

### GOES-18/19 GLM result

- Requests: two fixed bucket listings and 30 immutable granules; 32 total with measured maximum
  concurrency two. The fixed prefix was `GLM-L2-LCFA/2026/249/20/`, selecting the first 15
  lexicographic objects for each operational satellite.
- Payload: 10,766,774 bytes (10.268 MiB) total; individual granules ranged from 218,715 to 529,118
  bytes, below the 2 MiB ceiling and 60 MiB aggregate ceiling.
- Listing fetch p50 125.760 ms and p95/max 140.195 ms. Granule fetch p50 219.447 ms, p95
  255.056 ms, and max 255.815 ms.
- Peak per-fetch process deltas were 2,170,736 bytes heap and 4,792,320 bytes RSS. Immutable-cache
  replay sent zero additional upstream requests.
- Every object had the NetCDF4/HDF5 signature, but the repository has no accepted decoder for the
  product's non-classic data model. Normalized flash count, decode p50/p95/max, playback cost,
  Cesium ingestion/update p95, and steady-frame p95 therefore remain unmeasurable.

## Decision

Both candidates remain `planned` and operationally `unavailable`.

The nowCOAST transport and image container bounds passed, but an image container is not proof of
browser decode, source-valid playback, real Cesium ingestion, or steady-frame behavior. The GOES
transport, payload, concurrency, and memory bounds passed, but adopting a NetCDF4/HDF5 runtime,
worker boundary, normalized record ceiling, and renderer without measured evidence would violate
the authorized architecture gate. Partial transport success does not activate either candidate.

No production contracts, fixtures, provider adapter, server route, runtime dependency, Cesium
controller, or Svelte control is added. Production live activation remains fail-closed pending a
separate terms record even if a future spike clears the technical gates. Future evaluation needs a
new authorized envelope and must not reuse this trial as implementation authority.

## Consequences

- Registry counts and active provider/feed/layer totals do not change.
- Registry freshness reasons and both source records now state the measured rejection instead of
  saying the spike has not started.
- ADR 0045's radar semantics are corrected: four hours is advertised product narrative, not a
  safe client assumption; current `timeInfo` is authoritative for selectable slices.
- Seed/test/CI behavior remains network-free, and no new package, renderer, worker, or bundle cost
  is introduced.
