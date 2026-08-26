# RUNBOOK.md — Operational Procedures & Incident Response

**Status:** Active · **Audience:** Human Operators & AI Agents · **Companion docs:** [PLAN.md](file:///g:/AI-TadPole-Eye-View/PLAN.md), [AGENTS.md](file:///g:/AI-TadPole-Eye-View/AGENTS.md)

---

## 1. STASIS Protocol (§STASIS)

**STASIS** is an automatic emergency lockdown triggered when budget thresholds, compliance rules, or severe logic errors trip. When STASIS is entered, all mutating operations and autonomous agent loops are immediately suspended.

### What happens during STASIS:
1. `BudgetGovernor.trip(reason, message)` triggers.
2. `stasis_active` flag is set to `true` in governance state.
3. All autonomous agent actions suspend immediately (no self-resumption allowed).
4. An `audit.outcome` snapshot with status `'blocked'` and the corresponding trip code is logged to the SQLite WAL.

### Trip Code Reference:
| Trip Code | Root Cause | Immediate Operator Remediation |
|---|---|---|
| `BUDGET_BREACH` | Spend exceeded session or hourly spend cap | Review cost allocation via `gev status`; adjust cap in environment if authorized |
| `LOGIC_BLOCKER` | Agent encountered unresolvable blocker (~3 consecutive failures) | Inspect audit log `task_ref` via `gev audit tail`; provide human guidance |
| `COMPLIANCE_DRIFT` | Boundary violation (e.g. unpinned fetch attempt, missing audit intent) | Revert offending branch; patch compliance guard |

### Resuming from STASIS (Human-only):
> [!CAUTION]
> AI agents are strictly forbidden from resuming themselves from STASIS. Only a verified human operator may resume the system using `gev resume`.

```bash
# Step 1: Inspect current system status and trip cause (< 100ms)
pnpm gev status

# Step 2: Tail recent audit entries to understand the exact trip context
pnpm gev audit tail --limit 20

# Step 3: Once the root cause is resolved, human operator executes resume override
pnpm gev resume "Budget cap increased after review"

# Step 4: Confirm STASIS state has returned to STASIS_INACTIVE
pnpm gev status
```

---

## 2. Telemetry Feeds & Seed Mode Management

GEV v2 enforces **Seed Mode by default**. Zero live API calls occur in development, testing, or CI unless explicitly instructed by a human developer.

### Seed Mode vs Live Mode Toggles:
- **Seed Mode (Default):** `GEV_SEED_MODE=1` — Replays deterministic recorded fixtures from `fixtures/` with zero external network access.
- **Live Mode:** `GEV_LIVE_MODE=1` — Calls external live APIs via `pinned-fetch` with TLS pinning and SSRF protection.

### Feed Diagnostics & Circuit Breaking:
```bash
# Check per-provider health, error rates, and remaining quotas
pnpm gev feeds health

# Inspect SQLite WAL for recent telemetry fetch attempts
pnpm gev audit tail -t mcp-tool-call --limit 10
```

When an upstream provider (e.g. OpenSky Network) is rate-limited or degraded:
1. The server automatically falls back to cached responses or deterministic seed fixtures.
2. Feature flags (e.g. `opensky.enabled`) can be dynamically toggled via the MCP `set_flag` tool or CLI without redeploying code.

---

## 3. Keyless Cesium 3D Globe Baseline & Fallbacks

GEV v2 operates **100% keyless by default** (ADR 0014).
- **Default Base Layer:** Ion-free OpenStreetMap raster imagery provider (`TileMapService` / OSM XYZ raster tiles).
- **No Cesium Ion Token Required:** The globe boots, centers on the target coordinates, and renders live/fixture flight point entities without any API key.
- **WebGL Fallback:** In headless CI and test environments, Cesium boots in headless WebGL mode verified via Playwright screenshot fixtures (`e2e/test-results/globe-flights.png`).

---

## 4. Active Documentation Guard (ADG) Gate

The **Active Documentation Guard (ADG)** is a hard CI gate preventing documentation drift (PLAN.md §2 Law 7).

```bash
# Run ADG validator across all repository documentation
pnpm docs:check
```

### When ADG Fails:
- **Broken File Link / Path:** A referenced path like `packages/...` or `docs/...` was renamed or deleted. Fix the link or update the documentation to match active code.
- **Dead Symbol Reference:** An exported type, class, or interface was renamed. Cross-check against actual exports in `packages/*/src/index.ts`.

---

## 5. Emergency Incident Response & Ethics Stops (PLAN.md §12)

GEV v2 strictly enforces ethical AI boundaries. If any task or tool call requests or implies:
- **Person-Tracking or De-anonymization** (correlating callsigns with individual passengers or pilots)
- **Facial Recognition or Biometrics**
- **Automated License Plate Recognition (ALPR)** or IMSI-catcher functionality
- **Autonomous Lethal Targeting or Weapons Integration**

**Protocol:**
1. Agent immediately **REFUSES** execution and enters `LOGIC_BLOCKER` STASIS.
2. An `audit.outcome` with `status: 'blocked'` and `error: 'ETHICS_VIOLATION_PLAN_12'` is logged to the WAL.
3. System alerts the human operator and requires formal ADR review.

---

## 6. Standard Developer Verification Commands

```bash
# Full affected monorepo validation
pnpm turbo run lint typecheck test build

# Active Documentation Guard check
pnpm docs:check

# Playwright E2E smoke tests (Cesium WebGL rendering & flight stream)
pnpm gev qa

# Dev server (starts Hono server + Vite web SPA in seed mode)
pnpm gev dev
```
