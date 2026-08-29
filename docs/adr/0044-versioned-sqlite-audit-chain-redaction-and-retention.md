# ADR 0044: Versioned SQLite audit chain, redaction, and retention boundaries

- **Status:** Accepted
- **Date:** 2026-08-29
- **Task:** PLAN.md 5.1.5
- **Chain contract:** `gev.audit.chain.v1`

## Context

The shared governance database durably stores audit intents and outcomes, M2 replay
state, and the M3 budget ledger. Audit rows are currently append-only by convention,
but they are not cryptographically linked. A changed, deleted, inserted, reordered,
or truncated row can therefore be mistaken for valid history. Audit payloads also
accept unknown tool and provider values, so secrets, private tenant fields, or
unbounded content could be persisted without a common redaction boundary.

Task 5.1.5 must add tamper evidence without rewriting legacy audit or M3 rows and
without introducing a process-local integrity claim. Retention must be explicit,
human approved, signed, and unable to erase active incident or reconciliation
evidence.

## Decision

### Versioned sidecar chain and migration

Governance schema version 4 adds an append-only `governance_audit_chain` sidecar,
a singleton `governance_audit_chain_state`, and append-only signed retention
receipts. Existing `audit_events` values and every M3 table remain unchanged.
Migration reads legacy audit rows in SQLite `rowid` order and creates one sidecar
link per row in the same `BEGIN IMMEDIATE` migration transaction. Legacy rows are
marked `legacy-preserved-v0`; no migration redaction or historical rewrite is
permitted.

The state row is a versioned genesis/checkpoint. It stores the current retained
anchor and durable head sequence/hash. The v1 genesis hash is SHA-256 over the UTF-8
domain string `gev.audit.chain.v1:genesis`. Sequence numbers begin at one. New audit
rows and their links commit in one immediate transaction, including audit writes
performed inside an existing M3 transaction. A writer verifies the durable head
link before appending; parallel SQLite writers therefore cannot fork the chain.

### Canonical bytes and hashes

The event payload is RFC 8785-compatible canonical JSON over the exact persisted
audit columns, represented as strings, integers, or explicit nulls, plus the event
format and redaction-policy version. JSON-valued audit columns remain their exact
stored strings inside that payload, so whitespace or byte changes are detectable.

For each sequence, SHA-256 is applied to UTF-8 canonical JSON with explicit domain
and version fields:

1. `payload_hash` covers `gev.audit.event.v1`, the redaction policy, and the exact
   persisted audit row.
2. `chain_hash` covers `gev.audit.link.v1`, sequence, previous hash, and payload hash.

Hashes are lowercase 64-character hexadecimal values. A new version must use a new
format identifier and retain every decoder needed by retained history.

### Verification and corruption policy

Verification is transport independent. It starts at the durable retained anchor,
walks every remaining sequence, recomputes payload and link hashes, validates the
head checkpoint, detects unchained audit rows, and verifies every retention receipt.
It reports a typed, bounded failure code and sequence without returning raw SQLite
errors or suspect payloads.

Ordinary runtime composition verifies the chain at startup and fails closed on an
invalid, missing, future, malformed, locked, or corrupt authority. A dedicated local
inspection path may open read-only and report invalid or unavailable status; it never
repairs data. There is no automatic rehash, deletion, fallback chain, or truncation
acceptance. Append-only database triggers add defense in depth but are not the
cryptographic trust boundary.

### Redaction before persistence

All new audit intents and outcomes, including M3 atomic audit writes, pass through
one `gev.audit.redaction.v1` policy before insertion and before subscriber
notification. The policy:

- replaces credential, authorization, cookie, token, secret, password, private-key,
  signature, and private tenant/business/contact fields with a fixed redaction marker;
- removes credential-like substrings from free text;
- bounds traversal depth, object keys, array items, string bytes, and total serialized
  payload bytes;
- replaces unsupported, cyclic, or oversized content with bounded metadata rather
  than persisting raw content; and
- applies the same bounded text treatment to targets, task references, errors, and
  retention reasons.

The audit trail records governance evidence, identifiers, bounded summaries, and
digests where safe; it is not a raw provider-response, tool-output, document, or
BusinessContext store. Redaction is intentionally irreversible.

### Signed retention boundary

V1 has no automatic time-based pruning. Retention is an explicit repository
operation requiring a human actor, a bounded reason, an operator-supplied Ed25519
signer, and a matching configured trusted public key. The signed canonical
`gev.audit.retention.v1` payload binds the previous anchor/receipt, pruned-through
sequence/hash, retained-from sequence, pre-prune head, signer/key identity, approval
time, and reason.

The retention intent is appended before pruning and its outcome afterward. Pruning
and boundary-state update are transactional. Receipts are never pruned. Verification
fails if a boundary signature, link, trusted key, or state reference is missing or
invalid. Retention is denied while STASIS is active or any M3 operation is `IN_DOUBT`,
and policy enforces a minimum retained-entry count and bounded batch size. No server,
MCP, or AI retention mutation is exposed by this task.

Private keys never enter contracts, SQLite, logs, fixtures, or errors. Production key
custody and remote retention authorization remain later deployment/identity decisions;
this task only defines the local verification boundary.

## Consequences

- Legacy audit and M3 data survive migration byte-for-byte while becoming linked to
  a versioned durable checkpoint.
- Every current writer shares one ordered append chain across processes and M3 units
  of work.
- Integrity inspection can distinguish valid, invalid, and unavailable storage
  without claiming silent recovery.
- Signed retention remains possible without making ordinary startup depend on a
  private key; a trusted public key is required only when retained history has a
  signed boundary.
- Full database-administrator compromise can still replace local state. Independent
  head publication or Tadpole anchoring is required for protection against an
  attacker who controls both the database and every external checkpoint; this ADR
  does not claim otherwise.
