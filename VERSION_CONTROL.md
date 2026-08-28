# VERSION_CONTROL.md — Git, Branching & Release Policy

**Status:** Active · **Enforced by:** branch protection + CI (not goodwill) · **Companion docs:** PLAN.md, AGENTS.md

## 1. Principles

1. **`main` is sacred and always green.** If it's red, fixing it outranks all other work.
2. **Everything is a PR.** Humans and agents follow the identical path — the only difference is who reviews.
3. **Linear, greppable history.** Squash-merges only. History reads like a changelog because it *is* one (§7).
4. **Commits correlate to the audit trail.** Every agent commit carries a `Task-Ref:` trailer matching its 4-Pillar brief ID and WAL entries. `git log` and `gev audit tail` tell one story.
5. **Trust lives in the gate, not the signature.** CI + human review are the trust boundary; commit signing is optional for humans, not required for agents (revisit at M2 when Tadpole can sign).

## 2. Repository topology

| Repo | Role | Policy |
|---|---|---|
| `DDS-Solutions/AI-Tadpole-Eye-View` | **This project. All development happens here.** | Public from day one |
| `DDS-Solutions/gods-eye-view` | Read-only upstream reference (fork of bilawalsidhu) | **Archive it** once this repo exists; description points here |
| `DDS-Solutions/AI-TadPole-OS` | Governance runtime, separate lifecycle | Integration via `ports.ts` + `PORTS_VERSION` negotiation only. **No submodules, no subtrees, no shared lockfiles — ever.** Duplicated schema shapes are acceptable; coupled repos are not |

**Porting from upstream:** cherry-pick or re-implement into our layout, one logical unit per PR tagged `chore(port): …`, each referencing the upstream commit SHA in the body. MIT obligations honored via `THIRD_PARTY_NOTICES.md` (upstream copyright + license text preserved for every ported module). This also satisfies §14 ADR seeds.

## 3. Branch model — trunk-based, short-lived

```
main ──────────●────●────●──►  (always releasable)
               ↑    ↑    ↑
        agent/B0042 fix/…  chore/port-ssrf   ← live ≤ 2–3 days, then merge or die
```

- **No develop/staging branches. No gitflow.** Environment isolation comes from seed mode + flags, not branches.
- **Naming:** `<type>/<short-slug>` — `feat/flight-feed`, `fix/ssrf-cgnat-gap`, `chore/port-cockpitmath`, `docs/adr-0007`.
- **Agent branches** additionally embed the brief ID: `feat/B0042-flight-store`. Greppable from commit, PR, and audit log alike.
- **Lifespan cap:** a branch older than 3 days gets rebased or closed — stale branches are how merge hell starts, and agents re-generate work cheaply anyway.
- Force-pushes: forbidden on `main` (protection-enforced), permitted on feature branches while unreviewed.

## 4. Commits

Conventional Commits, scope = package name (already mandated in AGENTS.md):

```
<type>(<scope>): <imperative summary>

[body: why, not what]

Task-Ref: B0042
```

- **Types:** `feat fix perf refactor test docs chore ci build revert`
- **Breaking changes** (post-1.0): `!` + `BREAKING CHANGE:` footer. During 0.x, breaking changes ride in minors (§6) — note them in the body.
- **`Task-Ref:` trailer is mandatory for agent commits,** optional for human ones. Correlation commands:
  ```bash
  git log --grep='Task-Ref: B0042'          # what did the agent change
  gev audit tail --task B0042               # what did it intend/do at runtime
  ```
- **Scope of audit ≠ scope of git:** routine commits inside the PR flow are *not* individually audited (that would flood the WAL with noise). Audited git-adjacent actions: anything touching `deploy.prod`, flag flips, direct-push attempts (blocked + logged), and release cuts.

## 5. Pull requests & branch protection

### PR lifecycle (identical for human and agent)

1. Branch from fresh `main` → implement with tests → self-verify in headless browser → open draft PR early for visibility.
2. PR body: what/why, DoD checklist ticked, dep justifications, **PLAN.md §10 box checked in the same PR** when it completes a plan item (keeps the tracker honest without extra churn-PRs).
3. CI runs `quality → build → e2e` (per `.github/workflows/ci.yml`). Enable **auto-merge (squash)** once green.
4. Human review → merge. Review focus order: architecture boundaries > security surface > test honesty > style (style is Biome's job, not the reviewer's).

### Branch protection — flip these on day one (Settings → Branches)

| Setting | Value |
|---|---|
| Require a PR before merging | ✅ (required approvals: **0 while solo** — you cannot approve your own PR; the checks are the gate. Raise to 1 at first external contributor) |
| Required status checks | `quality`, `build`, `e2e` (+ `docs:check`) |
| Require linear history | ✅ |
| Allow force pushes / deletions on `main` | ❌ / ❌ |
| Allowed merge methods | **Squash only** (disable merge commits & rebase-merge) |
| Automatically delete head branches | ✅ |
| Auto-merge | ✅ |
| Tag protection pattern | `v*` |
| Push protection + secret scanning | ✅ (day one — agents iterate fast near `.env.example` files; let GitHub catch accidents) |

**Red-main protocol:** revert-first, always. A bad merge is reverted within minutes and fixed properly on a branch; `main` being green is worth more than anyone's pride in a commit.

## 6. Versioning — one product version, evidence-based readiness

The root `package.json` is the sole product-version authority. Runtime health reads
that manifest; internal private `@gev/*` packages retain independent `0.x` workspace
versions until publication is explicitly approved.

The repository published `v1.0.0` and `v1.1.0` on 2026-08-26 before the maturity
criteria in the earlier policy were satisfied. Those tags are immutable historical
early-access releases. They are not evidence of 13-layer parity, verified M2/M3,
tamper-evident persistence, or production readiness, and history must not be rewritten
to relabel them.

Future versions continue monotonically from `1.1.0`; the project will not move
backwards to `0.x`. SemVer communicates compatibility, while production readiness is
an evidence gate recorded in `PLAN.md` §14. The first release after that gate uses the
next compatible `1.x` version unless a real breaking change requires `2.0.0`.

The production-readiness gate remains: complete planned geospatial scope, keyless seed
boot, verified shared governance through M2/M3, finalized threat model, clean licensing,
and the complete uncached release suite—including stable Playwright evidence—green.
No tag number by itself satisfies that gate.

## 7. Releases & artifacts

Release metadata is generated by **release-please**, but release creation is disabled by
default. A human may set the repository variable `GEV_RELEASES_ENABLED=true` only after
the current release-evidence gate is recorded in `PLAN.md` §17. Removing or bypassing
that guard requires its own reviewed policy change.

```yaml
# .github/workflows/release.yml
name: release
on:
  push:
    branches: [main]
permissions:
  contents: write
  pull-requests: write
jobs:
  release-please:
    if: ${{ vars.GEV_RELEASES_ENABLED == 'true' }}
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          release-type: node
```

- With the gate enabled, the release PR accumulates merged commits → a human merges it → it cuts the tag + GitHub Release + `CHANGELOG.md`.
- **Docker:** on tag push, build multi-stage image → `ghcr.io/dds-solutions/ai-tadpole-eye-view:{semver, major.minor, latest}`; `main` gets rolling `edge` tags.
- **Cadence:** no automatic early-stage releases while the gate is disabled. Use commit SHAs for unreleased demos; never imply an unreleased commit is production-ready.
- Hotfixes: `hotfix/<slug>` from the tagged commit → PR → PATCH bump via `fix:` commit.

## 8. Multi-agent concurrency (near-future proofing)

Now: one agent session at a time, so conflicts are rare. Soon (parallel sessions on providers vs UI):

- File leases (30s TTL, from the governance stubs) prevent two agents editing one file.
- Rebase-before-merge is the agent's job (`git fetch && git rebase origin/main` immediately before opening/updating the PR); CI's `--affected` keeps wasted runs near zero.
- If merge contention actually hurts: adopt a GitHub merge queue **then** — not before. Premature queues punish a solo-dev cadence.
- Both agents' PRs carry distinct `Task-Ref`s; the WAL makes post-hoc "who wrote what" trivially answerable.

## 9. Hygiene rails

- **Binaries:** fixtures stay JSON (text-diffable). Hero GIFs/screenshots go in GitHub Releases or the README via user-attachments URL — **no Git LFS** unless something legitimately exceeds ~10 MB (decide then, don't pre-install).
- **`.gitignore` from scaffold day one:** `node_modules/ dist/ test-results/ playwright-report/ .env .env.* !.env.example coverage/ *.tsbuildinfo`.
- **History rewrite:** never on `main`. If a secret lands despite push protection: rotate the secret first, then `git filter-repo` via an incident ADR — rotation outranks scrubbing.
- **CODEOWNERS** seeded now (`* @DDS-Solutions/...`), so ownership routing exists before the second human arrives.

## 10. Day-one checklist (fold into Phase 0 item 1)

- [ ] Create repo; push scaffold; enable all §5 protections
- [ ] Push protection + secret scanning ON
- [ ] `release.yml` merged; label `autorelease: pending` appears on next merge
- [ ] Archive `DDS-Solutions/gods-eye-view` with pointer description
- [ ] `THIRD_PARTY_NOTICES.md` created (empty until first port lands)
- [ ] Verify: agent opens PR → CI gates → auto-merge after your review → squash lands → release PR appears
