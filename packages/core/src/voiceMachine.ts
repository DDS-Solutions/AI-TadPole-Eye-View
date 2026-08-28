import { assign, setup } from 'xstate';
import type { SimClock } from './clock.js';
import { SystemClock } from './clock.js';

export interface TranscriptEntry {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  ts: number;
}

export interface VoiceMachineContext {
  sessionId: string | null;
  provider: 'openai-realtime' | 'openrouter' | 'ollama' | 'mock';
  transcript: TranscriptEntry[];
  activeTool: { callId: string; name: string; args: unknown } | null;
  error: string | null;
  stasisReason: string | null;
  lastBargeInTs: number | null;
}

export type VoiceMachineEvents =
  | { type: 'CONNECT'; provider?: VoiceMachineContext['provider'] }
  | { type: 'CONNECTED'; sessionId: string }
  | { type: 'DISCONNECT' }
  | { type: 'VAD_SPEECH_START' }
  | { type: 'VAD_SPEECH_END' }
  | { type: 'USER_TEXT'; text: string }
  | { type: 'AGENT_TEXT_CHUNK'; delta: string }
  | { type: 'AGENT_AUDIO_CHUNK'; size: number }
  | { type: 'AGENT_AUDIO_COMPLETE' }
  | { type: 'TOOL_CALL'; callId: string; name: string; args: unknown }
  | { type: 'TOOL_RESOLVED'; callId: string; result: unknown }
  | { type: 'STASIS_TRIPPED'; reason?: string }
  | { type: 'STASIS_RESUMED' }
  | { type: 'ERROR'; message: string };

export function createVoiceSessionMachine(clock: SimClock = new SystemClock()) {
  let messageCounter = 0;
  const nextMessageId = (role: 'user' | 'agent' | 'system' = 'user'): string => {
    messageCounter = (messageCounter + 1) % 1_000_000;
    return `${role}_${clock.now()}_${messageCounter}`;
  };

  return setup({
    types: {
      context: {} as VoiceMachineContext,
      events: {} as VoiceMachineEvents,
    },
    actions: {
      setSessionId: assign({
        sessionId: (_, params: { sessionId: string }) => params.sessionId,
        error: () => null,
      }),
      setError: assign({
        error: (_, params: { message: string }) => params.message,
      }),
      setStasis: assign({
        stasisReason: (_, params: { reason?: string }) =>
          params.reason || 'STASIS Budget/Compliance Trip',
      }),
      clearStasis: assign({
        stasisReason: () => null,
      }),
      addUserMessage: assign({
        transcript: ({ context }, params: { text: string }) => [
          ...context.transcript,
          {
            id: nextMessageId('user'),
            role: 'user' as const,
            text: params.text,
            ts: clock.now(),
          },
        ],
      }),
      appendAgentDelta: assign({
        transcript: ({ context }, params: { delta: string }) => {
          const transcript = context.transcript;
          const len = transcript.length;
          const last = len > 0 ? transcript[len - 1] : undefined;
          if (last && last.role === 'agent') {
            const next = transcript.slice(0, len - 1);
            next.push({
              id: last.id,
              role: last.role,
              text: last.text + params.delta,
              ts: last.ts,
            });
            return next;
          }
          return [
            ...transcript,
            {
              id: nextMessageId('agent'),
              role: 'agent' as const,
              text: params.delta,
              ts: clock.now(),
            },
          ];
        },
      }),
      setActiveTool: assign({
        activeTool: (_, params: { callId: string; name: string; args: unknown }) => params,
      }),
      clearActiveTool: assign({
        activeTool: () => null,
      }),
      recordBargeIn: assign({
        lastBargeInTs: () => clock.now(),
      }),
      resetContext: assign({
        sessionId: () => null,
        error: () => null,
        activeTool: () => null,
      }),
    },
  }).createMachine({
    id: 'voiceSession',
    initial: 'idle',
    context: {
      sessionId: null,
      provider: 'mock',
      transcript: [],
      activeTool: null,
      error: null,
      stasisReason: null,
      lastBargeInTs: null,
    },
    on: {
      STASIS_TRIPPED: {
        target: '.stasis_halted',
        actions: [
          {
            type: 'setStasis',
            params: ({ event }) => ({ reason: 'reason' in event ? event.reason : undefined }),
          },
        ],
      },
      DISCONNECT: {
        target: '.idle',
        actions: [{ type: 'resetContext' }],
      },
    },
    states: {
      idle: {
        on: {
          CONNECT: {
            target: 'connecting',
            actions: assign({
              provider: ({ event }) =>
                event && 'provider' in event && event.provider ? event.provider : 'mock',
            }),
          },
        },
      },
      connecting: {
        on: {
          CONNECTED: {
            target: 'connected',
            actions: [
              { type: 'setSessionId', params: ({ event }) => ({ sessionId: event.sessionId }) },
            ],
          },
          ERROR: {
            target: 'error',
            actions: [{ type: 'setError', params: ({ event }) => ({ message: event.message }) }],
          },
        },
      },
      connected: {
        initial: 'listening',
        states: {
          listening: {
            on: {
              VAD_SPEECH_START: {
                target: 'listening',
              },
              VAD_SPEECH_END: {
                target: 'processing',
              },
              USER_TEXT: {
                target: 'processing',
                actions: [
                  { type: 'addUserMessage', params: ({ event }) => ({ text: event.text }) },
                ],
              },
            },
          },
          processing: {
            on: {
              AGENT_TEXT_CHUNK: {
                actions: [
                  { type: 'appendAgentDelta', params: ({ event }) => ({ delta: event.delta }) },
                ],
              },
              AGENT_AUDIO_CHUNK: {
                target: 'speaking',
              },
              TOOL_CALL: {
                target: 'executing_tool',
                actions: [
                  {
                    type: 'setActiveTool',
                    params: ({ event }) => ({
                      callId: event.callId,
                      name: event.name,
                      args: event.args,
                    }),
                  },
                ],
              },
              AGENT_AUDIO_COMPLETE: {
                target: 'listening',
              },
              VAD_SPEECH_START: {
                // Early barge-in while agent is preparing response
                target: 'listening',
                actions: [{ type: 'recordBargeIn' }],
              },
            },
          },
          speaking: {
            on: {
              AGENT_TEXT_CHUNK: {
                actions: [
                  { type: 'appendAgentDelta', params: ({ event }) => ({ delta: event.delta }) },
                ],
              },
              AGENT_AUDIO_COMPLETE: {
                target: 'listening',
              },
              VAD_SPEECH_START: {
                // Critical barge-in: cancel playback and transition to listening immediately
                target: 'listening',
                actions: [{ type: 'recordBargeIn' }],
              },
              TOOL_CALL: {
                target: 'executing_tool',
                actions: [
                  {
                    type: 'setActiveTool',
                    params: ({ event }) => ({
                      callId: event.callId,
                      name: event.name,
                      args: event.args,
                    }),
                  },
                ],
              },
            },
          },
          executing_tool: {
            on: {
              TOOL_RESOLVED: {
                target: 'processing',
                actions: [{ type: 'clearActiveTool' }],
              },
              VAD_SPEECH_START: {
                target: 'listening',
                actions: [{ type: 'recordBargeIn' }],
              },
            },
          },
        },
      },
      stasis_halted: {
        on: {
          STASIS_RESUMED: {
            target: 'idle',
            actions: [{ type: 'clearStasis' }],
          },
        },
      },
      error: {
        on: {
          CONNECT: {
            target: 'connecting',
          },
          DISCONNECT: {
            target: 'idle',
          },
        },
      },
    },
  });
}

export const voiceSessionMachine = createVoiceSessionMachine();
