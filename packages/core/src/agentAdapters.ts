import { type OpenAIToolDefinition, getOpenAIToolDefinitions } from '@gev/contracts';

export interface ToolCallItem {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type AgentStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface AgentAdapterEvents {
  onTextDelta?: (delta: string) => void;
  onAudioDelta?: (chunk: Uint8Array) => void;
  onToolCall?: (toolCall: ToolCallItem) => void;
  onStatusChange?: (status: AgentStatus) => void;
  onError?: (error: Error) => void;
  onSpeechStarted?: () => void;
  onSpeechStopped?: () => void;
}

export interface AgentProviderAdapter {
  status: AgentStatus;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendText(text: string): Promise<void>;
  sendAudioChunk(chunk: ArrayBuffer | Uint8Array): Promise<void>;
  cancelResponse(): Promise<void>;
  submitToolResult(callId: string, result: unknown): Promise<void>;
  setEvents(events: AgentAdapterEvents): void;
}

export interface OpenAIRealtimeAdapterOptions {
  /**
   * Ephemeral Realtime Session Token (minted securely via POST /api/voice/session).
   * Note: NEVER expose long-lived API keys on client bundles.
   */
  clientSecret: string;
  wsUrl?: string;
  model?: string;
  voice?: string;
  tools?: OpenAIToolDefinition[];
}

/**
 * OpenAI Realtime GA WebSocket Client Adapter.
 */
export class OpenAIRealtimeAdapter implements AgentProviderAdapter {
  status: AgentStatus = 'idle';
  private ws: WebSocket | null = null;
  private events: AgentAdapterEvents = {};
  private options: OpenAIRealtimeAdapterOptions;

  constructor(options: OpenAIRealtimeAdapterOptions) {
    this.options = options;
  }

  setEvents(events: AgentAdapterEvents): void {
    this.events = { ...this.events, ...events };
  }

  async connect(): Promise<void> {
    this.updateStatus('connecting');
    const wsUrl = this.options.wsUrl || 'wss://api.openai.com/v1/realtime';
    const model = this.options.model || 'gpt-4o-realtime-preview';
    const url = `${wsUrl}?model=${encodeURIComponent(model)}`;

    try {
      // In browser/Node environment, construct WebSocket with Bearer auth in headers or subprotocol
      if (typeof WebSocket === 'undefined') {
        throw new Error('WebSocket is not supported in this runtime environment');
      }

      this.ws = new WebSocket(url, [
        'realtime',
        `openai-insecure-api-key.${this.options.clientSecret}`,
        'openai-beta.realtime-v1',
      ]);

      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        this.updateStatus('connected');
        this.sendSessionConfig();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (e) => {
        const err = new Error(`Realtime WebSocket error: ${JSON.stringify(e)}`);
        this.events.onError?.(err);
        this.updateStatus('error');
      };

      this.ws.onclose = () => {
        this.updateStatus('idle');
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.events.onError?.(error);
      this.updateStatus('error');
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.updateStatus('idle');
  }

  async sendText(text: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.sendJson({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      },
    });
    this.sendJson({ type: 'response.create' });
  }

  async sendAudioChunk(chunk: ArrayBuffer | Uint8Array): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const base64Audio = this.bufferToBase64(chunk);
    this.sendJson({
      type: 'input_audio_buffer.append',
      audio: base64Audio,
    });
  }

  async cancelResponse(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.sendJson({ type: 'response.cancel' });
  }

  async submitToolResult(callId: string, result: unknown): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.sendJson({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(result),
      },
    });
    this.sendJson({ type: 'response.create' });
  }

  private sendSessionConfig(): void {
    const tools = this.options.tools || getOpenAIToolDefinitions();
    this.sendJson({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        voice: this.options.voice || 'alloy',
        instructions:
          'You are GEV Copilot, an OSINT tactical console assistant. You assist human operators by querying live flight, marine, satellite, seismic, wildfire, CCTV, and radio telemetry feeds, and controlling the 3D globe viewport via tools.',
        tools,
        tool_choice: 'auto',
      },
    });
  }

  private sendJson(payload: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    try {
      const msg = JSON.parse(data);
      switch (msg.type) {
        case 'response.output_audio.delta':
        case 'response.audio.delta':
          if (msg.delta) {
            const bytes = this.base64ToBuffer(msg.delta);
            this.events.onAudioDelta?.(bytes);
          }
          break;
        case 'response.output_text.delta':
        case 'response.text.delta':
        case 'response.audio_transcript.delta':
          if (msg.delta) {
            this.events.onTextDelta?.(msg.delta);
          }
          break;
        case 'response.function_call_arguments.done':
          this.events.onToolCall?.({
            callId: msg.call_id,
            name: msg.name,
            arguments: JSON.parse(msg.arguments || '{}'),
          });
          break;
        case 'input_audio_buffer.speech_started':
          this.events.onSpeechStarted?.();
          break;
        case 'input_audio_buffer.speech_stopped':
          this.events.onSpeechStopped?.();
          break;
        case 'response.done':
        case 'response.cancelled':
          this.updateStatus('idle');
          break;
      }
    } catch {
      // Ignore unparseable frames
    }
  }

  private updateStatus(status: AgentStatus): void {
    this.status = status;
    this.events.onStatusChange?.(status);
  }

  private bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

    // Fast path: Node.js Buffer
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
    }

    // Fast path: Browser chunked btoa
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const sub = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...sub);
    }
    return typeof btoa === 'function' ? btoa(binary) : '';
  }

  private base64ToBuffer(base64: string): Uint8Array {
    // Fast path: Node.js Buffer
    if (typeof Buffer !== 'undefined') {
      const buf = Buffer.from(base64, 'base64');
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }

    // Browser atob fallback
    const binary = typeof atob === 'function' ? atob(base64) : '';
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

export interface MockAgentAdapterOptions {
  deterministicSeed?: number;
}

/**
 * Deterministic Mock Agent Adapter for seed-mode, CI tests, and airgapped execution.
 */
export class MockAgentAdapter implements AgentProviderAdapter {
  status: AgentStatus = 'idle';
  private events: AgentAdapterEvents = {};
  private callCounter: number;

  constructor(options: MockAgentAdapterOptions = {}) {
    this.callCounter = Math.trunc(options.deterministicSeed ?? 0);
  }

  setEvents(events: AgentAdapterEvents): void {
    this.events = { ...this.events, ...events };
  }

  async connect(): Promise<void> {
    this.status = 'connected';
    this.events.onStatusChange?.('connected');
  }

  async disconnect(): Promise<void> {
    this.status = 'idle';
    this.events.onStatusChange?.('idle');
  }

  async sendText(text: string): Promise<void> {
    const lower = text.toLowerCase();

    if (lower.includes('tokyo') || lower.includes('fly to')) {
      this.events.onTextDelta?.('Navigating camera to Tokyo, Japan. ');
      this.events.onToolCall?.({
        callId: this.nextCallId(),
        name: 'fly_to_location',
        arguments: { lat: 35.6762, lon: 139.6503, altitude_m: 50000 },
      });
      return;
    }

    if (lower.includes('layer') || lower.includes('flight') || lower.includes('toggle')) {
      this.events.onTextDelta?.('Updating layer status on the tactical HUD. ');
      this.events.onToolCall?.({
        callId: this.nextCallId(),
        name: 'toggle_layer',
        arguments: { layer: 'flights', enabled: true },
      });
      return;
    }

    if (lower.includes('health') || lower.includes('feeds')) {
      this.events.onTextDelta?.('Querying telemetry provider health statuses. ');
      this.events.onToolCall?.({
        callId: this.nextCallId(),
        name: 'get_feed_health',
        arguments: {},
      });
      return;
    }

    this.events.onTextDelta?.(`Acknowledged: "${text}". All tactical sensors operational.`);
  }

  async sendAudioChunk(_chunk: ArrayBuffer | Uint8Array): Promise<void> {
    // In mock mode, simulate VAD audio gating and synthetic response
    this.events.onSpeechStarted?.();
    setTimeout(() => {
      this.events.onSpeechStopped?.();
      this.events.onTextDelta?.('Mock voice telemetry stream acknowledged.');
    }, 50);
  }

  async cancelResponse(): Promise<void> {
    this.events.onTextDelta?.('[INTERRUPTED]');
  }

  private nextCallId(): string {
    this.callCounter += 1;
    return `mock_call_${this.callCounter}`;
  }

  async submitToolResult(callId: string, result: unknown): Promise<void> {
    this.events.onTextDelta?.(` [Tool ${callId} completed with result: ${JSON.stringify(result)}]`);
  }
}
