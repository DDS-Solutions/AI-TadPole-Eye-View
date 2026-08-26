# Security & Threat Model

**Project:** God's Eye View v2 (GEV v2) · **Status:** Phase 0 Active · **Companion docs:** PLAN.md, AGENTS.md

God's Eye View is an agent-native OSINT console tracking public telemetry on a 3D globe. This document details the security architecture, threat model, and vulnerability reporting procedures.

---

## 1. Vulnerability Reporting

Please report security issues **privately** — do not open public issues for exploitable vulnerabilities.

- **GitHub Private Advisory:** [Report a vulnerability](https://github.com/DDS-Solutions/AI-Tadpole-Eye-View/security/advisories/new)
- **Security Contact:** `security@dds-solutions.internal` (or via GitHub profile)

Include full reproduction steps, affected versions/commits, and estimated impact. Fixes will be prioritized and credited in the security advisory.

---

## 2. Secrets & Credential Isolation

The golden rule: **Secrets remain strictly server-side.**

| Key / Secret | Storage Location | Exposure & Lifecycle |
|---|---|---|
| `OPENAI_API_KEY` | Server environment | Browser receives short-lived ephemeral session token (`ek_`); raw key is never shipped |
| `OPENSKY_CLIENT_ID / SECRET` | Server environment | Server authenticates and proxies feed; browser never sees credentials |
| `AISSTREAM_API_KEY` | Server environment | Server maintains persistent connection; browser reads aggregated local cache |
| Google Maps API Key | Client bundle (restricted) | Public key restricted by HTTP referrer + API restriction to Map Tiles API |
| Cesium ion Token | Client bundle (restricted) | Public `assets:read` scoped token with URL restrictions |

- **Logs & AI redaction:** All server logs (via `pino`) redact sensitive authorization headers, bearer tokens, and secrets by construction. AI agents interact with interfaces only and never inspect raw credentials.

---

## 3. Network Perimeter & SSRF Defense

All outbound HTTP requests from server processes must use `packages/security/pinned-fetch`:

1. **DNS Pre-Resolution:** Validates all A and AAAA DNS records prior to connection establishment.
2. **Strict CIDR Blocking:** Rejects private (RFC 1918), CGNAT (`100.64.0.0/10`), loopback (`127.0.0.0/8`), link-local, benchmarking (`198.18.0.0/15`), 6to4 relay (`192.88.99.0/24`), broadcast, and reserved address spaces.
3. **IPv6 Sanitization:** Restricts IPv6 strictly to global unicast (`2000::/3`), automatically unwraps and validates IPv4-mapped IPv6 (`::ffff:0:0/96`) and NAT64 (`64:ff9b::/96`), and blocks documentation/Teredo/6to4/ULA spaces.
4. **IP Pinning (Zero TOCTOU):** The connection socket is pinned directly to the pre-validated IP address via custom dispatcher lookup hooks to eliminate DNS rebinding attacks.
5. **No Open Relay:** Client requests cannot specify arbitrary upstream target URLs; data proxies connect exclusively to allowlisted hosts and paths.
6. **Mandatory Timeouts & Byte Caps:** Every outbound fetch enforces `AbortSignal.timeout` and strict response byte caps to eliminate connection leaks and memory exhaustion.
