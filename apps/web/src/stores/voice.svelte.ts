import {
  type AgentProviderAdapter,
  GovernedToolExecutor,
  MockAgentAdapter,
  OpenAIRealtimeAdapter,
  type TranscriptEntry,
  voiceSessionMachine,
} from '@gev/core';
import { createActor } from 'xstate';

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
  audioLevel: number;
  isMuted: boolean;
  error: string | null;
  stasisActive: boolean;
}

class VoiceStore {
  state = $state<VoiceStoreState>({
    status: 'idle',
    provider: 'mock',
    transcript: [
      {
        id: 'init-msg',
        role: 'system',
        text: 'Tactical Voice Agent initialized in Seed/Mock mode. Click microphone or type to issue commands.',
        ts: Date.now(),
      },
    ],
    activeTool: null,
    audioLevel: 0,
    isMuted: false,
    error: null,
    stasisActive: false,
  });

  private actor = createActor(voiceSessionMachine);
  private adapter: AgentProviderAdapter | null = null;
  public executor: GovernedToolExecutor = new GovernedToolExecutor();
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private animFrameId: number | null = null;

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
      this.state.error = snapshot.context.error;
      this.state.stasisActive = snapshot.context.stasisReason !== null;
    });

    this.actor.start();
  }

  async connect(provider: 'mock' | 'openai-realtime' = 'mock'): Promise<void> {
    this.state.provider = provider;
    this.actor.send({ type: 'CONNECT', provider });

    try {
      if (provider === 'openai-realtime') {
        const res = await fetch('/api/voice/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'gpt-4o-realtime-preview' }),
        });

        if (!res.ok) {
          throw new Error(`Failed to fetch voice session token: HTTP ${res.status}`);
        }

        const data = (await res.json()) as { client_secret: string; session_id: string };
        this.adapter = new OpenAIRealtimeAdapter({ clientSecret: data.client_secret });
      } else {
        this.adapter = new MockAgentAdapter();
      }

      this.wireAdapterEvents(this.adapter);
      await this.adapter.connect();

      this.actor.send({ type: 'CONNECTED', sessionId: `sess_${Date.now()}` });
      this.startAudioVisualizer();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.actor.send({ type: 'ERROR', message: errorMsg });
    }
  }

  disconnect(): void {
    if (this.adapter) {
      this.adapter.disconnect().catch(() => {});
      this.adapter = null;
    }
    this.stopAudioVisualizer();
    this.actor.send({ type: 'DISCONNECT' });
  }

  async sendUserMessage(text: string): Promise<void> {
    if (!text.trim()) return;

    if (this.state.status === 'idle') {
      await this.connect(this.state.provider);
    }

    this.actor.send({ type: 'USER_TEXT', text });

    if (this.adapter) {
      await this.adapter.sendText(text);
    }
  }

  triggerBargeIn(): void {
    this.actor.send({ type: 'VAD_SPEECH_START' });
    if (this.adapter) {
      this.adapter.cancelResponse().catch(() => {});
    }
  }

  toggleMute(): void {
    this.state.isMuted = !this.state.isMuted;
  }

  private wireAdapterEvents(adapter: AgentProviderAdapter): void {
    adapter.setEvents({
      onTextDelta: (delta) => {
        this.actor.send({ type: 'AGENT_TEXT_CHUNK', delta });
      },
      onAudioDelta: (chunk) => {
        this.actor.send({ type: 'AGENT_AUDIO_CHUNK', size: chunk.byteLength });
      },
      onSpeechStarted: () => {
        this.triggerBargeIn();
      },
      onSpeechStopped: () => {
        this.actor.send({ type: 'VAD_SPEECH_END' });
      },
      onToolCall: async (call) => {
        this.actor.send({
          type: 'TOOL_CALL',
          callId: call.callId,
          name: call.name,
          args: call.arguments,
        });

        // Governed execution
        const execRes = await this.executor.execute(call.name, call.arguments, {
          actor: 'ai',
          task_ref: 'voice-session',
        });

        this.actor.send({
          type: 'TOOL_RESOLVED',
          callId: call.callId,
          result: execRes.result,
        });

        if (this.adapter) {
          await this.adapter.submitToolResult(call.callId, execRes.result);
        }
      },
      onError: (err) => {
        this.actor.send({ type: 'ERROR', message: err.message });
      },
    });
  }

  private startAudioVisualizer(): void {
    if (typeof window === 'undefined') return;

    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;

      this.audioCtx = new AudioContextClass();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 64;

      const loop = () => {
        if (!this.analyser || this.state.status === 'idle') return;

        if (this.state.status === 'speaking') {
          // Synthetic audio pulsing during agent speech
          this.state.audioLevel = 0.4 + 0.5 * Math.sin(Date.now() / 120);
        } else if (this.state.status === 'listening' && !this.state.isMuted) {
          // Subtle resting wave
          this.state.audioLevel = 0.15 + 0.1 * Math.sin(Date.now() / 300);
        } else {
          this.state.audioLevel = 0.05;
        }

        this.animFrameId = requestAnimationFrame(loop);
      };

      this.animFrameId = requestAnimationFrame(loop);
    } catch {
      // Audio visualization unavailable in current environment
    }
  }

  private stopAudioVisualizer(): void {
    if (this.animFrameId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.state.audioLevel = 0;
  }
}

export const voiceStore = new VoiceStore();
