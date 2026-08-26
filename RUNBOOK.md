# RUNBOOK.md — Operational Procedures & Incident Response

**Status:** Active · **Audience:** Operators & AI Agents · **Companion docs:** PLAN.md, AGENTS.md

---

## 1. STASIS Protocol (§STASIS)

**STASIS** is an automatic emergency lockdown triggered when budget thresholds, compliance rules, or severe logic errors trip.

### What happens during STASIS:
1. `BudgetGovernor.trip(reason, message)` triggers.
2. `stasis_active` flag is set to `true` in governance state.
3. All autonomous agent actions suspend immediately.
4. An `audit.outcome` snapshot with status `'blocked'` and trip code is logged to WAL.

### Trip Codes:
| Trip Code | Cause | Immediate Remediation |
|---|---|---|
| `BUDGET_BREACH` | Spend exceeded session cap | Review cost allocation; adjust cap in environment if authorized |
| `LOGIC_BLOCKER` | Agent encountered unresolvable blocker | Inspect audit log `task_ref`; provide human guidance |
| `COMPLIANCE_DRIFT` | Boundary violation (e.g. unpinned fetch attempt) | Revert offending branch; patch compliance guard |

### Resuming from STASIS (Human-only):
> [!CAUTION]
> AI agents are strictly forbidden from resuming themselves from STASIS. Only a human operator may resume the system.

```bash
# 1. Inspect current status and trip cause
pnpm gev status

# 2. View the last audit entries that triggered the trip
pnpm gev audit tail --limit 20

# 3. Once resolved, human executes resume command
pnpm gev resume --by human:dev --reason "Resolved underlying budget limit"
```

---

## 2. Provider Feed Degradation

When an external provider feed (OpenSky, AISStream, USGS, etc.) fails or returns rate-limit errors:

1. **Check Feed Health:**
   ```bash
   pnpm gev feeds health
   ```
2. **Circuit Breaker Flag Flip:**
   Toggle the provider flag without deploying code:
   ```bash
   pnpm gev flags set provider.opensky.enabled false
   ```
3. **Fallback Mode:**
   System automatically falls back to secondary sources (e.g. `adsb.lol` for flights) or serves cached/seed fixtures under `GEV_SEED_MODE=1`.

---

## 3. Deployment & Local Verification

```bash
# Clean install
pnpm install --frozen-lockfile

# Verification pass
pnpm turbo run lint typecheck test --affected
pnpm e2e

# Dev server (seed mode default)
pnpm gev dev
```
