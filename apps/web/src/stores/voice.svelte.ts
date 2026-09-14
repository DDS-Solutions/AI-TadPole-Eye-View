import { type OperatorToolName, getOpenAIToolDefinitions } from '@gev/contracts';
import {
  type AgentProviderAdapter,
  GovernedToolExecutor,
  MockAgentAdapter,
  OpenAIRealtimeAdapter,
  type TranscriptEntry,
  createVoiceSessionMachine,
} from '@gev/core';
import { createActor } from 'xstate';
import { runtimeClock } from '../runtimeClock.js';

export const VOICE_OPERATOR_TOOL_NAMES = [
  'fly_to_location',
  'toggle_layer',
  'select_entity',
  'inspect_telemetry',
  'query_aoi',
] as const satisfies readonly OperatorToolName[];

export interface VoiceStoreState {
  status:
    | 'idle'
    | 'connecting'
    | 'listening'
    | 'processing'
    | 'speaking'
    | 'stasis_halted'
    | 'error';
  provider: 'mock' | 'openai-realtime';
  transcript: TranscriptEntry[];
  activeTool: { callId: string; name: string; args: unknown } | null;
  isMuted: boolean;
  error: string | null;
  stasisActive: boolean;
}

const MAX_PROVIDER_TRANSCRIPT_CHARS = 64 * 1024;
export const MAX_VOICE_COMMAND_CHARS = 4096;

class VoiceStore {
  state = $state<VoiceStoreState>({
    status: 'idle',
    provider: 'mock',
    transcript: [],
    activeTool: null,
    isMuted: false,
    error: null,
    stasisActive: false,
  });

  private actor = createActor(createVoiceSessionMachine(runtimeClock));
  private adapter: AgentProviderAdapter | null = null;
  private pendingAdapter: AgentProviderAdapter | null = null;
  private connectionAttempt = 0;
  private connectionAbort: AbortController | null = null;
  private providerTranscriptChars = 0;
  private operationalError: string | null = null;
  // Browser code has no durable shared governance ports. The common executor therefore
  // remains intentionally fail-closed until a server-authoritative consumer supplies them.
  public executor: GovernedToolExecutor = new GovernedToolExecutor({
    clock: runtimeClock,
    allowedTools: VOICE_OPERATOR_TOOL_NAMES,
  });
  constructor() {
    this.actor.subscribe((snapshot) => {
      const val = snapshot.value;
      if (typeof val === 'string') {
        this.state.status = val as VoiceStoreState['status'];
      } else if (val && typeof val === 'object') {
        const subVal = Object.values(val)[0] as string;
        this.state.status = (subVal as VoiceStoreState['status']) || 'listening';
      }

      this.state.transcript = snapshot.context.transcript;
      this.state.activeTool = snapshot.context.activeTool as VoiceStoreState['activeTool'];
      this.state.error = snapshot.context.error ?? this.operationalError;
      this.state.stasisActive = snapshot.context.stasisReason !== null;
    });

    this.actor.start();
  }

  async connect(provider: 'mock' | 'openai-realtime' = 'mock'): Promise<boolean> {
    if (this.state.stasisActive) {
      this.setOperationalError('Voice connections remain locked while STASIS is active.');
      return false;
    }
    const attempt = ++this.connectionAttempt;
    this.connectionAbort?.abort();
    this.connectionAbort = null;
    const previousAdapter = this.adapter ?? this.pendingAdapter;
    this.adapter = null;
    this.pendingAdapter = null;
    this.operationalError = null;
    this.providerTranscriptChars = 0;
    this.state.provider = provider;
    this.actor.send({ type: 'DISCONNECT' });
    this.actor.send({ type: 'CONNECT', provider });

    await previousAdapter?.disconnect().catch(() => {});
    if (attempt !== this.connectionAttempt) return false;

    let candidate: AgentProviderAdapter | null = null;
    try {
      if (provider === 'openai-realtime') {
        const opsToken =
          typeof window !== 'undefined'
            ? localStorage.getItem('gev_ops_token') || sessionStorage.getItem('gev_ops_token')
            : null;

        const abortController = new AbortController();
        this.connectionAbort = abortController;
        const res = await fetch('/api/voice/session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(opsToken ? { Authorization: `Bearer ${opsToken}` } : {}),
          },
          body: JSON.stringify({ model: 'gpt-4o-realtime-preview' }),
          signal: abortController.signal,
        });

        if (!res.ok) {
          throw new Error(`Failed to fetch voice session token: HTTP ${res.status}`);
        }

        const data = (await res.json()) as { client_secret?: unknown };
        if (typeof data.client_secret !== 'string' || data.client_secret.length === 0) {
          throw new Error('Voice session response did not include a client secret');
        }
        candidate = new OpenAIRealtimeAdapter({
          clientSecret: data.client_secret,
          tools: getOpenAIToolDefinitions(VOICE_OPERATOR_TOOL_NAMES),
        });
      } else {
        candidate = new MockAgentAdapter();
      }

      if (attempt !== this.connectionAttempt) {
        await candidate.disconnect().catch(() => {});
        return false;
      }

      this.pendingAdapter = candidate;
      this.wireAdapterEvents(candidate, attempt);
      await candidate.connect();

      if (attempt !== this.connectionAttempt || this.pendingAdapter !== candidate) {
        await candidate.disconnect().catch(() => {});
        return false;
      }

      this.pendingAdapter = null;
      this.adapter = candidate;
      this.connectionAbort = null;
      this.actor.send({ type: 'CONNECTED', sessionId: `sess_${runtimeClock.now()}` });
      return true;
    } catch (err: unknown) {
      if (this.pendingAdapter === candidate) this.pendingAdapter = null;
      await candidate?.disconnect().catch(() => {});
      if (attempt !== this.connectionAttempt) return false;
      this.connectionAbort = null;
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.actor.send({ type: 'ERROR', message: errorMsg });
      return false;
    }
  }

  disconnect(): void {
    this.connectionAttempt += 1;
    this.connectionAbort?.abort();
    this.connectionAbort = null;
    const activeAdapter = this.adapter ?? this.pendingAdapter;
    this.adapter = null;
    this.pendingAdapter = null;
    if (!this.state.stasisActive) {
      this.operationalError = null;
      this.actor.send({ type: 'DISCONNECT' });
    }
    void activeAdapter?.disconnect().catch(() => {});
  }

  async sendUserMessage(text: string): Promise<boolean> {
    const message = text.trim();
    if (!message) return false;
    if (message.length > MAX_VOICE_COMMAND_CHARS) {
      this.setOperationalError(
        `Voice commands are limited to ${MAX_VOICE_COMMAND_CHARS} characters.`
      );
      return false;
    }
    if (this.state.stasisActive) {
      this.setOperationalError('Voice commands remain locked while STASIS is active.');
      return false;
    }

    if (this.state.status === 'idle' || this.state.status === 'error') {
      const connected = await this.connect(this.state.provider);
      if (!connected) return false;
    }

    const adapter = this.adapter;
    if (this.state.status !== 'listening' || !adapter) {
      this.setOperationalError('Voice session is not ready for another command.');
      return false;
    }

    this.actor.send({ type: 'USER_TEXT', text: message });
    try {
      await adapter.sendText(message);
      return true;
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (adapter === this.adapter) this.failActiveSession(adapter, error.message);
      return false;
    }
  }

  triggerBargeIn(): void {
    this.actor.send({ type: 'VAD_SPEECH_START' });
    const adapter = this.adapter;
    if (adapter) {
      void adapter.cancelResponse().catch((err: unknown) => {
        if (adapter !== this.adapter) return;
        this.setOperationalError(err instanceof Error ? err.message : String(err));
      });
    }
  }

  toggleMute(): void {
    this.state.isMuted = !this.state.isMuted;
  }

  private wireAdapterEvents(adapter: AgentProviderAdapter, attempt: number): void {
    const isActive = () => attempt === this.connectionAttempt && adapter === this.adapter;
    adapter.setEvents({
      onTextDelta: (delta) => {
        if (!isActive()) return;
        const remaining = MAX_PROVIDER_TRANSCRIPT_CHARS - this.providerTranscriptChars;
        if (remaining <= 0) return;
        const boundedDelta = delta.slice(0, remaining);
        this.providerTranscriptChars += boundedDelta.length;
        if (boundedDelta) this.actor.send({ type: 'AGENT_TEXT_CHUNK', delta: boundedDelta });
        if (delta.length >= remaining) {
          this.setOperationalError('Voice response stopped at the transcript safety limit.');
          void adapter.cancelResponse().catch(() => {});
        }
      },
      onAudioDelta: (chunk) => {
        if (!isActive()) return;
        this.actor.send({ type: 'AGENT_AUDIO_CHUNK', size: chunk.byteLength });
      },
      onSpeechStarted: () => {
        if (!isActive()) return;
        this.triggerBargeIn();
      },
      onSpeechStopped: () => {
        if (!isActive()) return;
        this.actor.send({ type: 'VAD_SPEECH_END' });
      },
      onToolCall: (call) => {
        if (!isActive()) return;
        void (async () => {
          this.actor.send({
            type: 'TOOL_CALL',
            callId: call.callId,
            name: call.name,
            args: call.arguments,
          });

          const execRes = await this.executor.execute(call.name, call.arguments, {
            actor: 'ai',
            task_ref: 'voice-session',
          });
          if (!isActive()) return;

          if (!execRes.success) {
            const errorMessage = execRes.error || 'Tool execution failed';
            this.setOperationalError(errorMessage);
            this.actor.send({
              type: 'TOOL_RESOLVED',
              callId: call.callId,
              result: { error: errorMessage },
            });
            await adapter.submitToolResult(call.callId, { error: errorMessage });
            return;
          }

          this.actor.send({
            type: 'TOOL_RESOLVED',
            callId: call.callId,
            result: execRes.result,
          });
          await adapter.submitToolResult(call.callId, execRes.result);
        })().catch((err: unknown) => {
          if (isActive()) {
            this.failActiveSession(adapter, err instanceof Error ? err.message : String(err));
          }
        });
      },
      onResponseComplete: () => {
        if (!isActive()) return;
        this.actor.send({ type: 'AGENT_AUDIO_COMPLETE' });
      },
      onStatusChange: (status) => {
        if (status === 'idle' && isActive()) {
          this.failActiveSession(adapter, 'Voice transport closed unexpectedly.');
        }
      },
      onError: (err) => {
        if (!isActive()) return;
        this.failActiveSession(adapter, err.message);
      },
    });
  }

  private failActiveSession(adapter: AgentProviderAdapter, message: string): void {
    if (adapter !== this.adapter || this.state.stasisActive) return;
    this.connectionAttempt += 1;
    this.connectionAbort?.abort();
    this.connectionAbort = null;
    this.adapter = null;
    this.pendingAdapter = null;
    this.operationalError = message;
    this.actor.send({ type: 'DISCONNECT' });
    void adapter.disconnect().catch(() => {});
  }

  private setOperationalError(message: string): void {
    this.operationalError = message;
    this.state.error = message;
  }
}

export const voiceStore = new VoiceStore();
