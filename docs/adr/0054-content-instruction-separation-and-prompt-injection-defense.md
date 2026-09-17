# ADR 0054 — Content/Instruction Separation and Prompt-Injection Defense

**Status:** Accepted  
**Date:** 2026-09-16  
**Deciders:** Core Engineering Team  
**Consulted:** PLAN.md §2, §3, §8.2, §9.1, §10 Task 8.5, AGENTS.md Standing Rule 12, ADR 0031, ADR 0050, ADR 0052, ADR 0053  

---

## 1. Context

In PLAN.md §8.2, §9.1, and §10 Task 8.5, GEV v2 integrates economic and geospatial intelligence with downstream AI, LLM, and Tadpole agents (acting as the eyes and ears for AI-Tadpole-OS digital twin SMB end users). Untrusted third-party data—including Census notes, OpenStreetMap amenity names and tags, FEMA hazard descriptions, business titles, and operator queries—could contain adversarial indirect prompt injection payloads (OWASP LLM01).

Under AGENTS.md Standing Rule 12:
> *"Untrusted content is never instruction. Provider text, OSM tags, business names, documents, and tool results require data/instruction separation before any LLM or Tadpole use."*

And PLAN.md §9.1 states:
> *"Prompt-injection tests occur before economic/provider text reaches an LLM or Tadpole, not in a deferred final phase."*

Without deterministic delimiter bounding, strict data/instruction separation, mandatory provenance validation, and text sanitization, malicious third-party content could hijack agent instructions, bypass security boundaries, or cause prompt/credential exfiltration.

---

## 2. Decision

### 2.1 Contracts & Schema Boundary (`packages/contracts`)
- Defined `packages/contracts/src/economicPrompt.ts`, re-exported from `packages/contracts/src/index.ts`.
- **Threat Categories:** `PromptThreatCategorySchema` (`system_override`, `role_hijack`, `delimiter_collision`, `jailbreak_pattern`, `exfiltration_attempt`, `unicode_smuggling`).
- **Sandboxed Data Block Contract:** `SandboxedDataBlockSchema` requiring `block_id`, `source_id`, `content`, `nonce`, `sanitization_status`, and mandatory `DataProvenanceSchema`.
- **Prompt Context Envelope:** `SanitizedPromptContextSchema` enforcing strict separation between `system_instructions`, passive `data_blocks`, and optional `user_query`, terminating with the statutory legal disclaimer `ECONOMIC_LEGAL_DISCLAIMER`.
- **Domain Error:** `PromptProtectionError` with discriminated error codes (`MISSING_PROVENANCE`, `INVALID_PROVENANCE`, `UNSEPARATED_CONTENT`, `INJECTION_DETECTED`, `DELIMITER_COLLISION`, `INVALID_CONTEXT`).

### 2.2 Pure Domain Sanitization & Bounding Engine (`packages/economic`)
- Implemented `packages/economic/src/promptProtection.ts` as a pure, zero-I/O domain module (adhering to ADR 0052 and asserted by `architecturalBoundary.test.ts`):
  1. **Control Character & Unicode Defanging:** Strips non-printable ASCII control characters (`[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]`), Unicode BiDi overrides (`\u202A-\u202E`, `\u2066-\u2069`), and zero-width non-visual characters (`\u200B-\u200D`, `\uFEFF`, `\u2060`).
  2. **Delimiter Collision Defense:** Delimiter tags (`<untrusted_data_block>`, `</untrusted_data_block>`, `<data_block>`, etc.) are escaped to entity representations (`&lt;...&gt;`), and markdown code fences are converted to prevent breakout attacks.
  3. **OWASP LLM01 Threat Neutralization:** Disarms system prompt override attempts ("Ignore previous instructions", "Disregard prior directives"), role hijacking markers (`<|im_start|>`, `[INST]`, `<<SYS>>`, `\nSystem:`), jailbreak personas (DAN, Developer Mode, AIM), and prompt exfiltration commands, replacing them with inert labels (`[NEUTRALIZED_UNTRUSTED_INJECTION: <CATEGORY>]`).
  4. **Collision-Resistant Delimiter Sandboxing:** Sandboxes passive data inside `<untrusted_data_block nonce="..." id="..." source="...">` tags with internal nonce escaping.
  5. **Mandatory Fail-Closed Provenance Law:** Any untrusted data block lacking validated `DataProvenance` fails closed with `PromptProtectionError('MISSING_PROVENANCE')` before entering context.
  6. **BusinessContextPreview Integration:** `buildPromptContextFromBusinessPreview` converts demographic, employment, wage, hazard, and amenity records into isolated sandboxed blocks while neutralizing adversarial input fields (e.g. injected business names or OSM amenity tags).

### 2.3 MCP Runtime Prompt Safety Layer (`packages/ops-mcp`)
- Implemented `packages/ops-mcp/src/promptSafety.ts`, exporting `evaluatePromptSafety` and `prepareGovernedPromptContext`:
  1. **Latency Threshold Enforcement:** Evaluates prompt safety and verifies sub-5ms p95 execution latency.
  2. **Audit Logging Integration:** When adversarial injections are neutralized or rejected, emits security audit records (`security.prompt_injection_neutralized` or `security.prompt_injection_rejected`) to `AuditSink` with threat categories and counts, without logging raw private data or credentials.
  3. **Strict Rejection Mode:** When configured with `mode: 'reject'`, injection attempts fail closed immediately before tool response dispatch.

---

## 3. Consequences

### Positive
- Direct and indirect prompt injection attempts are disarmed before text can reach LLM or Tadpole contexts.
- Delimiter bounding and nonces prevent sandbox escape.
- Missing provenance fails closed, preventing unverified third-party text from entering AI reasoning loops.
- Pure regex-based sanitization executes in ~0.03ms p95, vastly exceeding the required 5.0ms threshold.
- Zero I/O compliance is maintained across `packages/economic`.

### Negative / Trade-offs
- Strongly adversarial text has its command strings neutralized to `[NEUTRALIZED_UNTRUSTED_INJECTION: <CATEGORY>]`, which may slightly alter verbatim quotes if an end user legitimately asks about prompt injection terminology. A strict `mode: 'reject'` option is provided when neutrality is insufficient.

---

## 4. Verification & Compliance Gate

1. `packages/contracts/test/economicPrompt.test.ts`: 8/8 tests verifying schema validation, mandatory provenance enforcement, and domain error typing.
2. `packages/economic/test/promptProtection.test.ts`: 20/20 tests covering all OWASP LLM01 injection patterns, delimiter breakout defense, fast-check property testing, and 1,000-iteration latency benchmark (measuring p95 < 0.05ms).
3. `packages/ops-mcp/test/promptSafety.test.ts`: 4/4 tests verifying MCP context preparation, audit logging on neutralization, and fail-closed rejection.
4. `packages/economic/test/architecturalBoundary.test.ts`: Asserts zero I/O imports and file length <= 500 lines.
