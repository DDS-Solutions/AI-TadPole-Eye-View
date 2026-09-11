# ADR 0026: Provider-Agnostic Voice Agent & XState Lifecycle Architecture

## Status
Accepted

## Date
2026-08-26

## Context
Phase 3 of [PLAN.md](../../PLAN.md) (§10) transitions God's Eye View v2 (`GEV v2`) from a passive OSINT console into an active, governed AI-assisted command platform. The tactical voice copilot must:
1. Support multiple backend LLM streaming protocols (OpenAI Realtime GA flow with ephemeral `ek_` tokens, OpenRouter streaming, Ollama local airgapped LLMs, and deterministic Seed/Mock mode).
2. Model a complex asynchronous lifecycle (idle, connecting, listening, processing, speaking, tool execution, stasis lockdown, error recovery).
3. Support instantaneous (<100ms) barge-in interruption when an operator speaks over active voice responses.
4. Integrate with STASIS governance to freeze immediately upon budget breach.

## Decision
1. **Provider-Agnostic Agent Adapters:**
   We establish the `AgentProviderAdapter` contract in `@gev/core`. `OpenAIRealtimeAdapter` implements the official WebSocket Realtime GA client protocol; `MockAgentAdapter` enables deterministic, keyless execution in tests and offline development.
2. **XState v5 Voice Session Machine:**
   We implement `voiceSessionMachine` using XState v5 statecharts. The machine deterministically transitions across hierarchical states: `idle` → `connecting` → `connected.listening` ↔ `connected.processing` ↔ `connected.speaking` ↔ `connected.executing_tool`.
3. **Barge-in Interruption:**
   When in `speaking` or `processing`, incoming `VAD_SPEECH_START` events immediately cancel audio playback, transmit response cancellation to the agent adapter, and transition the statechart to `listening`.
4. **STASIS Lock Suspension:**
   `STASIS_TRIPPED` transitions the session to `stasis_halted`, preventing any further tool mutations or spend until human operator intervention (`pnpm gev resume`).

## Consequences
- Clean separation of transport, statechart, audio processing, and tactical actuators.
- Deterministic unit and property testing in Vitest with zero live API dependencies.
- Zero-drift conformance with Active Documentation Guard (ADG).

## Task 6.6 lifecycle hardening amendment (2026-09-11)

The original adapter boundary and XState lifecycle remain authoritative, with the following
readiness and ownership rules made explicit:

1. `connect()` resolves only after the WebSocket open event and successful session configuration;
   a bounded timeout or pre-ready close/error rejects it. Sending text before readiness fails
   visibly instead of returning successfully and dropping the command.
2. The web store assigns a monotonically increasing connection attempt. A newer connect,
   provider switch, cancel, or disconnect aborts token acquisition, closes pending adapters, and
   prevents callbacks from stale attempts from changing XState or submitting tool results.
3. Terminal response events return the connected statechart to listening without marking the
   persistent transport idle. Provider events, tool arguments, transcript content, and rendered
   argument previews are bounded before they enter long-lived state or UI.
4. The voice HUD performs no animation-frame rune writes. Visual state animation is CSS-driven;
   local drawer, scroll-follow, unread, focus, and draft state remain component-owned.

Focused tests use injected fake WebSockets and intercepted browser routes. They cover readiness,
timeout, error, stale-attempt races, first-command delivery, barge-in latency, bounded content,
and supported viewport geometry without live OpenAI calls.
