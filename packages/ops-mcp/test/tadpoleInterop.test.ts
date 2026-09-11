import { PassThrough } from 'node:stream';
import { FrozenClock } from '@gev/core';
import { afterEach, describe, expect, it } from 'vitest';
import { type OperatorContext, createOperatorContext } from '../src/context.js';
import { GevMcpServer } from '../src/server.js';

/** Immutable source coordinates for the pinned AI-Tadpole-OS client transcript. */
const TADPOLE_PIN = {
  commit: '329d32d6d3940ff4564d94c1797f540065dbc6a0',
  evidenceCommit: '2dcde21f537cde6885950c5091078e83a2d1bd3c',
  version: '1.1.462',
  sourceBlobs: {
    stdio: 'f513735a45327392b80869db534d4496f478b538',
    jsonrpc: 'df2c781c66eb20e34e3e35b3e3e7da0974c0e03c',
    adaptive: 'a46df3c99901ecc0110f65e706d8753fb62b0441',
    httpClient: 'd768096830724f95885225757fb6a28d0993998e',
    httpHeaders: '7d1aa65dc6d561d688251636466333b56b6c8d88',
    httpClassification: 'f2762d306aee00f01cf81491b8187bb11525dd1f',
  },
} as const;

const PINNED_DISCOVER_LINE =
  '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/clientCapabilities":{},"io.modelcontextprotocol/clientInfo":{"name":"ai-tadpole-os","version":"1.1.462"},"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}\n';
const EXPECTED_DISCOVER_RESPONSE =
  '{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Method not found: server/discover"}}\n';
const PINNED_LEGACY_INITIALIZE_LINE =
  '{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"capabilities":{},"clientInfo":{"name":"ai-tadpole-os","version":"1.1.462"},"protocolVersion":"2024-11-05"}}\n';
const EXPECTED_LEGACY_INITIALIZE_RESPONSE =
  '{"jsonrpc":"2.0","id":2,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"@gev/ops-mcp","version":"0.1.0"}}}\n';
const PINNED_INITIALIZED_NOTIFICATION = {
  jsonrpc: '2.0',
  method: 'notifications/initialized',
} as const;

const contexts: OperatorContext[] = [];

function nextChunk(output: PassThrough): Promise<string> {
  return new Promise((resolve) => {
    output.once('data', (chunk) => resolve(chunk.toString()));
  });
}

afterEach(() => {
  while (contexts.length > 0) contexts.pop()?.governanceContext.close();
});

describe('pinned AI-Tadpole-OS stdio interoperability', () => {
  it('preserves the exact modern-probe to legacy-initialize transcript', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const context = createOperatorContext({ clock: new FrozenClock(1_700_000_000_000) });
    contexts.push(context);
    const server = new GevMcpServer({ context, input, output });
    server.start();

    const discoverResponse = nextChunk(output);
    input.write(PINNED_DISCOVER_LINE);
    await expect(discoverResponse).resolves.toBe(EXPECTED_DISCOVER_RESPONSE);

    const initializeResponse = nextChunk(output);
    input.write(PINNED_LEGACY_INITIALIZE_LINE);
    await expect(initializeResponse).resolves.toBe(EXPECTED_LEGACY_INITIALIZE_RESPONSE);

    await expect(server.handleRequest(PINNED_INITIALIZED_NOTIFICATION)).resolves.toBeNull();
    input.end();

    expect(TADPOLE_PIN).toEqual({
      commit: expect.stringMatching(/^[0-9a-f]{40}$/),
      evidenceCommit: expect.stringMatching(/^[0-9a-f]{40}$/),
      version: '1.1.462',
      sourceBlobs: expect.objectContaining({
        stdio: expect.stringMatching(/^[0-9a-f]{40}$/),
        jsonrpc: expect.stringMatching(/^[0-9a-f]{40}$/),
        adaptive: expect.stringMatching(/^[0-9a-f]{40}$/),
      }),
    });
  });
});
