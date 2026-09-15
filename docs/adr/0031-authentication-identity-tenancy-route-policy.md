# ADR 0031: Authentication, identity, tenancy, and route policy

- **Status:** Accepted; production provisioning pending and fail-closed
- **Date:** 2026-09-14
- **Task:** PLAN.md 7.1; resolves OQ-4
- **Extends:** ADR 0020, ADR 0027, ADR 0032, ADR 0041, ADR 0042, ADR 0043, ADR 0044

## Context

GEV has two pre-Phase-7 authorization forms. Privileged HTTP routes use the local
`GEV_OPS_TOKEN` compatibility credential and reduce every valid caller to a generic human.
Modern HTTP MCP already uses an injected verifier and a strict request-local context containing
an AI principal, tenant, scopes, issuer, audience/resource, and validity window. Neither form
defines the production human identity provider, a shared role vocabulary, resource ownership,
session/revocation behavior, or tenant export and deletion ownership.

Task 7.1 must establish one contract-validated authority without provisioning a live identity
provider, enabling remote MCP, persisting BusinessContext, or implementing later provider,
credential, economic, or intelligence UI work. Production must remain unavailable until the
approved issuer is actually provisioned and injected at composition.

The developer selected OQ-4 Option A and authorized the exact Task 7.1 four-pillar brief on
2026-09-14. The identifiers below are approved deployment targets and may be replaced by a later
ADR before production. Their presence is not evidence that DNS, an Auth0 tenant, or a live
deployment exists.

## Decision

### Production identity provider and verifier

The provisional production provider is **Auth0 Organizations**. GEV remains a resource server:
it never stores passwords, accepts an ID token as an API credential, or treats browser/session
claims as handler authority. Human clients use Authorization Code with PKCE. Tadpole and other
approved service identities use an organization-scoped client-credentials grant.

The approved exact profile is:

| Field | Value |
|---|---|
| Issuer | `https://dds-solutions-gev.us.auth0.com/` |
| REST API audience/resource | `https://dds-solutions-gev.us.auth0.com/api/gev` |
| MCP audience/resource | `https://dds-solutions-gev.us.auth0.com/api/gev/mcp` |
| Production access-token algorithm | `RS256` only |
| Maximum access-token lifetime | 300 seconds |

The production adapter accepts OAuth access-token JWTs only. It requires `typ=at+jwt`, an exact
issuer, exactly one expected audience/resource, `sub`, `client_id`, `iat`, `nbf`, `exp`, and
`jti`. It verifies signatures against keys belonging to the configured issuer and rejects
`none`, symmetric algorithms, algorithm confusion, multiple/unexpected audiences, caller-chosen
issuers, JWKS/introspection URLs, query tokens, and trusted-forwarded-header identity. Remote key
retrieval, when later provisioned, must use the repository's pinned-fetch boundary and an exact
deployment allowlist. Unknown keys, invalid or revoked credentials, and unavailable required
verification fail closed.

`GEV_OPS_TOKEN` remains a non-production local compatibility credential only. It is never mapped
to the production Auth0 issuer and cannot establish production identity. Local stdio retains its
documented process trust boundary.

### Principal, tenant, membership, and roles

The immutable principal key is the tuple `(issuer, sub)`. Email, display name, IP address,
forwarded headers, task input, tool arguments, and resource identifiers never establish identity.

Every accepted token selects exactly one active Auth0 Organization. The verified `org_id` becomes
GEV's opaque `tenant_id`; the verified organization membership supplies one role. Switching
tenants requires a newly issued token for that organization. GEV never auto-provisions membership
and never infers it from a requested path, header, body, scene name, or tool argument.

The closed role vocabulary is:

| Role | Actor | Authority boundary |
|---|---|---|
| `viewer` | human | Tenant-scoped non-sensitive reads only |
| `operator` | human | Tenant operations and governed mutations |
| `tenant_admin` | human | Tenant membership administration and later Layer Access, export, and deletion requests |
| `platform_admin` | human | Platform control-plane operations; no implicit access to another tenant's content |
| `ai_copilot` | ai | Organization-scoped service identity with explicit capabilities; never human-only actions |

Role and capability checks are conjunctive: a role never manufactures a capability, and a scope
never grants a role. Every tenant-owned read or mutation requires the requested resource's
`tenant_id` to equal the immutable request context. Even `platform_admin` needs explicit
membership in a tenant to access that tenant's content. STASIS resume, ledger reconciliation,
retention, export, and deletion remain human-only; AI identities cannot request or approve them.

### Session expiry and revocation

- Human access tokens expire within five minutes. A human session has a 30-minute idle limit and
  an eight-hour absolute limit.
- Browser refresh credentials remain server-side, rotate on use, and never enter browser storage,
  logs, URLs, or audit payloads.
- Service access tokens expire within five minutes and receive no refresh token.
- `jti`, subject, session, membership, and role revocations are inputs to the injected verifier.
  Critical revocation disables the matching session immediately. Role or membership removal
  invalidates continued access; a caller must obtain a new token.
- Human logout uses provider logout and, when provisioned, signed back-channel logout. A required
  revocation authority outage fails closed rather than extending a session.

Task 7.1 implements the validation and revocation seams with deterministic tests. Live Auth0,
JWKS, logout, and callback provisioning remain deployment work and are not silently enabled.

### Retention, export, and deletion ownership

The approved profile has no deviations from these defaults:

- Raw access/refresh tokens and disallowed private claims have zero durable retention. The
  normalized identity context is request-local. Authentication diagnostics retain bounded,
  redacted security events for 90 days.
- Tenant content belongs to the tenant organization rather than an individual principal. Removing
  a member terminates access but does not delete organization-owned content.
- A human `tenant_admin` may request a complete machine-readable tenant export after recent
  authentication and the shared approval/audit path. The export is tenant-bound, size-bounded,
  encrypted in transit, short-lived, and unavailable to AI identities.
- A human `tenant_admin` owns tenant deletion requests. Deletion requires recent authentication,
  explicit confirmation, and shared approval. Access is disabled immediately; tenant content is
  recoverable for 30 days, then purged from primary storage and aged out of backups within 60 days.
  Restores must replay deletion tombstones so deleted tenants do not reappear.
- A `platform_admin` may execute an approved deletion or legal/incident hold but gains no implicit
  right to inspect or export tenant content. Holds and exceptions require separately recorded
  human authority.
- Governance audit, approval, and ledger evidence is not bulk-deleted with tenant content. It
  contains only bounded identifiers and remains subject to ADR 0044's signed retention boundary;
  retention receipts are never pruned. Later persistence must document pseudonymization and any
  legally required erasure without breaking chain verification.

Phase 13 remains the owner of BusinessContext persistence, encryption, backups, export artifact
format, and verified physical deletion. This ADR supplies the authority and lifecycle constraints
that Phase 13 must implement.

## Alternatives considered

1. **Opaque access tokens with online introspection.** This improves immediate central revocation
   but makes every protected request depend on identity-provider latency and availability.
2. **Self-hosted OIDC.** This avoids a managed provider but makes GEV responsible for credential
   storage, account recovery, patching, key rotation, and identity availability.
3. **The shared operations token as production identity.** Rejected because it has no stable
   principal, tenant membership, role, issuer/audience, expiry, or per-session revocation.
4. **Multiple active tenants or roles in one token.** Rejected for Phase 7 because it increases
   confused-deputy risk, token size, and ambiguous audit authority. A tenant switch obtains a new
   single-membership token.

## Consequences

- HTTP and MCP can consume one immutable, request-local identity contract while retaining their
  transport-specific protocol handling.
- Ownership checks can occur before body parsing, domain dispatch, audit mutation, or provider
  access, and can be tested as a finite role/resource matrix.
- Auth0 is provisional and isolated behind an injected verifier. Changing the provider or exact
  identifiers requires an ADR amendment and regression evidence, not a handler rewrite.
- Production remains fail-closed until the selected issuer, keys, callback/logout endpoints, and
  deployment host/resource identifiers are provisioned and verified. This ADR does not authorize
  network access or remote MCP enablement.

## References

- [RFC 9068: JWT Profile for OAuth 2.0 Access Tokens](https://www.rfc-editor.org/rfc/rfc9068.html)
- [RFC 8707: Resource Indicators for OAuth 2.0](https://www.rfc-editor.org/rfc/rfc8707.html)
- [RFC 9700: Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700.html)
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)
- [Auth0 Organizations for machine-to-machine applications](https://auth0.com/docs/manage-users/organizations/organizations-for-m2m-applications)
- [Auth0 custom domains](https://auth0.com/docs/customize/custom-domains)
