# Security & Threat Model

**Project:** GEV v2 (`AI-TadPole-Eye-View`) · **Status:** Phase 5.0 hardening · **Companion docs:** [PLAN.md](./PLAN.md), [AGENTS.md](./AGENTS.md), [RUNBOOK.md](./RUNBOOK.md)

GEV v2 is an agent-native geospatial OSINT telemetry console tracking public data on a 3D globe. This document details the threat model, trust boundaries, STRIDE analysis across the system topology, and incident response procedures.

---

## 1. System Topology & Trust Boundaries

```text
┌───────────────────────────────────────────────────────────────────────────┐
│ [UNTRUSTED] Browser / Web SPA (Svelte 5 + CesiumJS)                       │
│  - No persistent secrets; WebGL canvas; deep-link URL hash parsing        │
└─────────────────────────────────────┬─────────────────────────────────────┘
                                      │ HTTP / SSE / WS (JSON Payloads)
                                      ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ [SEMI-TRUSTED] Backend Server (Hono)                                      │
│  - Authenticated ephemeral token minting (ek_) and feed caching           │
│  - Per-client request rate limits are pending hardening work              │
│  - Upstream proxy routing via pinned-fetch (SSRF guarded, TLS pinned)     │
└──────────────────────┬───────────────────────────────┬────────────────────┘
                       │                               │
                       ▼ Stdio / SQLite WAL            ▼ HTTPS / WSS
┌───────────────────────────────────────────┐ ┌─────────────────────────────┐
│ [SECURE SEAM] Governance & Operator MCP   │ │ [EXTERNAL] Telemetry Feeds  │
│  - AuditSink (WAL to SQLite)              │ │  - OpenSky, AISStream, USGS │
│  - BudgetGovernor & STASIS trip code      │ │  - FIRMS, Overpass, Radio   │
│  - PromptApprovalGate (Human-in-the-loop) │ └─────────────────────────────┘
└───────────────────────────────────────────┘
```

---

## 2. STRIDE Threat Analysis Matrix

| Threat Category | Potential Attack Vector | System Countermeasure & Mitigation |
|---|---|---|
| **Spoofing** | Rogue client impersonating authorized operator or injecting fake telemetry | Short-lived ephemeral tokens (`ek_`) for AI sessions; strict Zod schema validation on all inbound REST/WS payloads. |
| **Tampering** | Malformed scene deep links or corrupted state injection | [packages/core/src/sceneSerializer.ts](./packages/core/src/sceneSerializer.ts) enforces Zod `SceneState.parse()` validation; Overpass sanitizer validates query AST. |
| **Repudiation** | Unaccounted mutating actions or rogue AI tool calls | **Rule 1 (Audit-Before-Action):** Every mutating operation logs `audit.intent` to SQLite WAL *before* execution and `audit.outcome` *after* completion. |
| **Information Disclosure** | Exposure of API keys, credentials, or internal server infrastructure | All upstream credentials (`OPENAI_API_KEY`, `AISSTREAM_API_KEY`, etc.) remain strictly server-side. Pinned-fetch blocks SSRF against internal cloud metadata endpoints. |
| **Denial of Service** | Unbounded external feed polling or runaway LLM token spend | Per-feed caching with TTL tiers; byte-capped streams with mandatory timeouts; `CapBudgetGovernor` trips **STASIS** lockdown when spend exceeds caps. |
| **Elevation of Privilege** | AI agent attempting self-resumption or modifying safety governors | Human-only STASIS resume and shared approval verification are required controls. The current local seed API and MCP stubs do not yet provide the final enforcement proof; remediation is tracked before task 5.0.4 and in PLAN.md Phase 5.1. |

### Current hardening limitations

- The SQLite audit sink is a durable WAL but is not hash chained; tamper verification is task 5.1.5.
- Local stdio MCP exposes only verified local-state tools and confines scene files to a configured root. A future network MCP transport must reuse those capability and confinement checks rather than introduce a transport-specific bypass.
- Collaboration still requires exact Origin enforcement, staged CRDT validation, remote-update origin tagging, and request/concurrency limits.
- Local tokenless seed mode is development-only and does not prove authenticated human resume or shared cross-process STASIS.

---

## 3. Network Perimeter & SSRF Defense (`packages/security`)

All outbound HTTP requests from server and worker processes must route through `pinned-fetch`:

1. **DNS Pre-Resolution:** Resolves all A and AAAA DNS records prior to connection establishment.
2. **Strict CIDR Blocking:** Rejects private (RFC 1918), CGNAT (`100.64.0.0/10`), loopback (`127.0.0.0/8`), link-local (`169.254.0.0/16`), benchmarking (`198.18.0.0/15`), 6to4 relay (`192.88.99.0/24`), broadcast, and reserved address spaces.
3. **IPv6 Sanitization:** Restricts IPv6 strictly to global unicast (`2000::/3`), unwraps and validates IPv4-mapped IPv6 (`::ffff:0:0/96`) and NAT64 (`64:ff9b::/96`), and blocks documentation/Teredo/6to4/ULA spaces.
4. **Socket Pinning (Zero TOCTOU):** The connection socket connects directly to the pre-validated IP address via custom lookup dispatchers to eliminate DNS rebinding attacks.
5. **No Open Relay:** Client requests cannot specify arbitrary upstream URLs; data proxies connect exclusively to allowlisted hosts and paths.
6. **Mandatory Timeouts & Byte Caps:** Every outbound fetch enforces `AbortSignal.timeout` and strict response byte caps to eliminate connection leaks and memory exhaustion.

---

## 4. AI Governance & Emergency STASIS Lockdown

The system wraps autonomous AI operations in rigid governance boundaries:

- **Hard Budget Caps:** `CapBudgetGovernor` tracks session and hourly spend. If spend exceeds thresholds, the governor automatically trips **STASIS**.
- **Human-in-the-Loop Resumption:** When in STASIS, all autonomous execution halts. AI agents are structurally barred from self-resuming. Only a human operator can execute `pnpm gev resume`.
- **Ethics Red Lines (PLAN.md §12):** Immediate hard abort and `LOGIC_BLOCKER` STASIS on any attempt at person-tracking, facial recognition, or ALPR/IMSI tracking.

---

## 5. Vulnerability Reporting

Please report security issues **privately** — do not open public issues for exploitable vulnerabilities.

- **GitHub Private Advisory:** [Report a vulnerability](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/security/advisories/new)
- **Direct Maintainer Contact:** Via security contact link on the GitHub Organization profile.

Include reproduction steps, affected commits, and estimated impact. Fixes are prioritized and credited in public advisories upon remediation.
