# ADR 0042 — Signed M2 approval verification

**Status:** Accepted (provisional integration profile)

**Date:** 2026-08-28
**Task:** PLAN.md 5.1.3 / OQ-2

## Context

The existing local `TadpoleM2Gatekeeper` generated its own Ed25519 key and approved
its own request. Its signature covered only request ID, decision, actor, and decision
time. It did not bind the audit intent, requested scopes, signer/key identity, nonce,
issuance time, or expiry; it had no durable replay store or production trust source.

The final Tadpole transport, production identity provider, and managed key service are
not selected yet. Task 5.1.3 nevertheless requires a real verification boundary whose
security properties are deterministic now and whose integration choices can be revised
without weakening the port.

## Decision

### Signed format and bound fields

The versioned payload format is `gev.m2.approval.v1`. Ed25519 signs the RFC 8785 JSON
Canonicalization Scheme (JCS) UTF-8 representation of exactly these fields:

- `format`, fixed to `gev.m2.approval.v1`;
- `request_id` and `intent_id`;
- `decision`, fixed to `approved`;
- the unique, lexicographically sorted approval `scopes`;
- `signer_id` and `key_id`;
- the verifier-issued, single-use `nonce`;
- `issued_at`, `decided_by` (fixed to `human`), `decided_at`, and `expires_at`.

The envelope fixes `algorithm` to `Ed25519` and encodes the 64-byte signature as
unpadded base64url. The verifier rejects unknown fields through the parsed versioned
contract rather than allowing unsigned extension semantics. `PORTS_VERSION` advances
to `0.2.0` because `ApprovalRequest` gains the required nonce and the signed provider
response is now a stable trust-boundary contract.

### Trusted signer and public-key source

Production verification uses an operator-supplied server-side allowlist of records:
`signerId`, `keyId`, Ed25519 SPKI public key, lifecycle status, and optional validity
window. The signed signer/key pair must match one exact record. The private key is
owned by the external human-approval system or managed signing service and never
enters GEV contracts, environment parsing, logs, browser bundles, fixtures, or errors.

Multiple active keys permit overlap during rotation. A retired key requires a
`validUntil` boundary and may verify only a still-live approval decided before that
boundary. A revoked key never verifies. Revocation and allowlist distribution are
operator configuration changes until the Phase 6/7 transport and identity decisions
select a managed source.

### Nonce and replay rules

GEV issues a random UUID nonce with each approval request. The signer must echo it in
the signed payload. After request matching, time checks, trust lookup, and signature
verification, the gate atomically inserts the nonce and request ID into the shared
SQLite governance database. Either value being present is a replay and fails before
handler dispatch. Consumption is permanent for this schema; failed handlers do not
release approvals. This is deliberately stricter than retrying a mutation with the
same approval. Retry/idempotency semantics belong to the M3 ledger in task 5.1.4.

Schema migration 2 adds `governance_approval_nonces`. Database lock, corruption,
future-schema, and unique-constraint failures fail closed with no in-memory fallback.

### Time profile

- Maximum request/approval lifetime: 60 seconds.
- Maximum permitted future clock skew: 5 seconds.
- Expiry is strict: no grace is added after `expires_at`.
- The signed expiry must exactly equal the verifier's request expiry.
- A decision may predate the request by no more than the skew allowance.
- Issuance must be at or after the human decision and before expiry.
- Decision and issuance may be no more than the skew allowance in the future.

All comparisons use the injected `SimClock`. These deliberately short values limit a
captured approval while allowing modest signer/verifier clock disagreement.

### Availability and local policy

`SignedApprovalGate` is the verification boundary. A production runtime with no
explicit verified gate/provider uses `UnavailableApprovalGate`, which denies. The old
auto/prompt stub cannot run with a permissive production policy. A renamed
`LocalM2ApprovalDemoGate` may generate a local key only in explicit non-production
seed/test/demo use; it is not a production trust source.

The shared executor remains responsible for one audit intent, durable governance
check, approval call, one handler dispatch, and one audit outcome. Invalid, stale,
replayed, wrongly scoped, wrongly signed, or unavailable approvals never reach the
handler.

## Standards basis

- RFC 8032 defines Ed25519/EdDSA.
- RFC 8785 defines deterministic JSON canonicalization for signing.
- RFC 9421 describes nonce plus creation/expiry timestamps as replay defenses.
- NIST SP 800-57 Part 1 Rev. 5 provides the key lifecycle vocabulary used for active,
  retired/deactivated, and revoked/compromised verification keys.

## Provisional choices and revision notes

The following are safe defaults, not claims about an unavailable Tadpole production
contract. Revisit them in a superseding ADR when the external integration is known:

1. Replace the local server-side public-key allowlist source with the approved managed
   trust distribution mechanism; retain exact signer/key matching and revocation.
2. Map `signer_id` to an authenticated principal only after OQ-1/OQ-4 define issuer,
   audience, tenant, and role semantics. Do not infer tenancy from the string today.
3. Change the 60-second lifetime or 5-second skew only with measured human workflow
   latency and replay-risk evidence.
4. If the production approver requires JWS/COSE or hardware-attested signatures, add a
   new payload/envelope version and conformance tests; do not reinterpret v1 bytes.
5. Establish nonce retention/compaction only after operational volume is measured.
   Any compaction must keep timestamp rejection sufficient to prevent a deleted nonce
   from making a captured approval usable again.
6. A future multi-approval/quorum workflow needs a new contract version. V1 authorizes
   exactly one verified human approval per request.

## Consequences

- Every approval proves the exact request, intent, scopes, signer/key, nonce, and time
  window that GEV executes.
- Cross-process replay is rejected transactionally in the same durable authority used
  for budget and STASIS state.
- Production cannot silently fall back to locally generated approval material.
- External transport, managed key custody, tenant identity, quorum approval, and M3
  settlement remain explicitly out of scope rather than being guessed into this task.
