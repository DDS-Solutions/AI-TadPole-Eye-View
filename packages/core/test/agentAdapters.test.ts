import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIRealtimeAdapter } from '../src/agentAdapters.js';

class FakeWebSocket {
  readyState = 0;
  binaryType: BinaryType = 'blob';
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  receive(payload: Record<string, unknown> | string): void {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  fail(): void {
    this.onerror?.(new Event('error'));
  }

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.(new CloseEvent('close'));
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('socket is not open');
    this.sent.push(data);
  }
}

function setup(connectionTimeoutMs = 10_000): {
  adapter: OpenAIRealtimeAdapter;
  socket: FakeWebSocket;
} {
  const socket = new FakeWebSocket();
  const adapter = new OpenAIRealtimeAdapter({
    clientSecret: 'ephemeral-test-token',
    connectionTimeoutMs,
    webSocketFactory: () => socket as unknown as WebSocket,
    tools: [],
  });
  return { adapter, socket };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('OpenAIRealtimeAdapter lifecycle', () => {
  it('does not report connected until the transport is open and session configuration is sent', async () => {
    const { adapter, socket } = setup();
    const statuses: string[] = [];
    adapter.setEvents({ onStatusChange: (status) => statuses.push(status) });

    const connection = adapter.connect();
    expect(adapter.status).toBe('connecting');
    expect(statuses).toEqual(['connecting']);
    await expect(adapter.sendText('must not be dropped')).rejects.toThrow('not ready');
    await expect(adapter.sendAudioChunk(new Uint8Array([1]))).rejects.toThrow('not ready');
    await expect(adapter.cancelResponse()).rejects.toThrow('not ready');
    await expect(adapter.submitToolResult('call-1', {})).rejects.toThrow('not ready');

    socket.open();
    await connection;

    expect(adapter.status).toBe('connected');
    expect(statuses).toEqual(['connecting', 'connected']);
    expect(JSON.parse(socket.sent[0] ?? '{}')).toMatchObject({ type: 'session.update' });
  });

  it('rejects deterministically when readiness times out', async () => {
    vi.useFakeTimers();
    const { adapter, socket } = setup(25);
    const onError = vi.fn();
    adapter.setEvents({ onError });

    const connection = adapter.connect();
    const rejection = expect(connection).rejects.toThrow('timed out after 25 ms');
    await vi.advanceTimersByTimeAsync(25);
    await rejection;

    expect(adapter.status).toBe('error');
    expect(socket.readyState).toBe(3);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('rejects a transport error before readiness without duplicate error events', async () => {
    const { adapter, socket } = setup();
    const onError = vi.fn();
    adapter.setEvents({ onError });

    const connection = adapter.connect();
    socket.fail();

    await expect(connection).rejects.toThrow('connection error');
    expect(adapter.status).toBe('error');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('keeps the transport connected when a response completes', async () => {
    const { adapter, socket } = setup();
    const onResponseComplete = vi.fn();
    adapter.setEvents({ onResponseComplete });
    const connection = adapter.connect();
    socket.open();
    await connection;

    socket.receive({ type: 'response.done', response: { status: 'completed' } });

    expect(onResponseComplete).toHaveBeenCalledTimes(1);
    expect(adapter.status).toBe('connected');
  });

  it('surfaces Realtime server errors without completing the response', async () => {
    const { adapter, socket } = setup();
    const onError = vi.fn();
    const onResponseComplete = vi.fn();
    adapter.setEvents({ onError, onResponseComplete });
    const connection = adapter.connect();
    socket.open();
    await connection;

    socket.receive({ type: 'error', error: { message: 'Session expired' } });

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Session expired' }));
    expect(onResponseComplete).not.toHaveBeenCalled();
  });

  it('reports an unexpected close after readiness without leaving a stale socket', async () => {
    const { adapter, socket } = setup();
    const statuses: string[] = [];
    adapter.setEvents({ onStatusChange: (status) => statuses.push(status) });
    const connection = adapter.connect();
    socket.open();
    await connection;

    socket.close();

    expect(adapter.status).toBe('idle');
    expect(statuses).toEqual(['connecting', 'connected', 'idle']);
    await expect(adapter.sendText('cannot disappear')).rejects.toThrow('not ready');
  });

  it('bounds provider events and tool arguments before dispatch', async () => {
    const { adapter, socket } = setup();
    const onError = vi.fn();
    const onTextDelta = vi.fn();
    const onToolCall = vi.fn();
    adapter.setEvents({ onError, onTextDelta, onToolCall });
    const connection = adapter.connect();
    socket.open();
    await connection;

    socket.receive('x'.repeat(256 * 1024 + 1));
    socket.receive({
      type: 'response.function_call_arguments.done',
      call_id: 'call-large',
      name: 'query_aoi',
      arguments: JSON.stringify({ value: 'x'.repeat(32 * 1024) }),
    });
    socket.receive({
      type: 'response.function_call_arguments.done',
      call_id: 'call-invalid-json',
      name: 'query_aoi',
      arguments: '{',
    });

    expect(onError).toHaveBeenCalledTimes(3);
    expect(onTextDelta).not.toHaveBeenCalled();
    expect(onToolCall).not.toHaveBeenCalled();
  });
});
