import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { serve } = requireFromServer('@hono/node-server');
const HOST = '127.0.0.1';
const GEV_PORT = 3000;
const CONFORMANCE_PROXY_PORT = 3001;
const MCP_RESOURCE = `http://${HOST}:${GEV_PORT}/mcp`;
const TEST_ACCESS_TOKEN = 'deterministic-task-6-5-conformance-token';
const TEST_NOW_MS = 1_700_000_000_000;
const CONFORMANCE_VERSION = '0.2.0-alpha.11';
const INSPECTOR_VERSION = '2.5.0';
const MAX_TOOL_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_PROXY_BODY_BYTES = 2 * 1024 * 1024;
const TOOL_TIMEOUT_MS = 60_000;
const ADVERTISED_SURFACE_SCENARIOS = ['tools-list', 'http-header-validation'];
const originalFetch = globalThis.fetch;
let blockedNonLoopbackFetches = 0;
const requestedScenario = process.argv[2];
if (requestedScenario !== undefined && !/^[a-z0-9-]+$/.test(requestedScenario)) {
  throw new Error(
    'Optional conformance scenario must contain only lowercase letters, digits, or hyphens'
  );
}

process.env.NODE_ENV = 'test';
process.env.GEV_SEED_MODE = '1';

const [{ createApp }, { FrozenClock }] = await Promise.all([
  import('../apps/server/dist/index.js'),
  import('../packages/core/dist/index.js'),
]);

let temporaryDirectory;
let conformanceOutput;
let inspectorConfig;
let created;
let gevServer;
let conformanceProxy;

const bearerVerifier = {
  async verify(request) {
    if (request.access_token !== TEST_ACCESS_TOKEN) throw new Error('invalid test token');
    return {
      actor: 'ai',
      principal: 'svc:tadpole-test',
      tenant_id: 'tenant-task-6-5',
      task_ref: 'task-6.5-official-conformance',
      issuer: 'https://auth.gev.test/',
      audience: MCP_RESOURCE,
      resource: MCP_RESOURCE,
      scopes: ['read.telemetry', 'read.audit', 'write.scenes', 'write.flags'],
      issued_at_epoch_seconds: TEST_NOW_MS / 1000 - 60,
      not_before_epoch_seconds: TEST_NOW_MS / 1000 - 60,
      expires_at_epoch_seconds: TEST_NOW_MS / 1000 + 60,
    };
  },
};

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, HOST, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function runNode(label, entry, args) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const appendBounded = (current, chunk) => {
      const combined = `${current}${chunk}`;
      return combined.length <= MAX_TOOL_OUTPUT_BYTES
        ? combined
        : combined.slice(combined.length - MAX_TOOL_OUTPUT_BYTES);
    };
    const child = spawn(process.execPath, [entry, ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        GEV_SEED_MODE: '1',
        MCP_CLIENT_CONFIG_PATH: path.join(temporaryDirectory, 'inspector-client.json'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, TOOL_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const output = `${stdout}\n${stderr}`.trim();
      reject(
        new Error(
          `${label} ${timedOut ? 'timed out' : 'exited'} with code ${String(code)} signal ${String(signal)}${
            output.length === 0 ? '' : `\n${output}`
          }`
        )
      );
    });
  });
}

function createConformanceProxy() {
  return http.createServer(async (request, response) => {
    try {
      if (request.socket.remoteAddress !== HOST) {
        response.writeHead(403, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'loopback clients only' }));
        return;
      }
      const chunks = [];
      let bodyBytes = 0;
      for await (const chunk of request) {
        const buffered = Buffer.from(chunk);
        bodyBytes += buffered.byteLength;
        if (bodyBytes > MAX_PROXY_BODY_BYTES) throw new Error('loopback proxy body limit exceeded');
        chunks.push(buffered);
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) {
          for (const item of value) headers.append(name, item);
        } else if (value !== undefined) {
          headers.set(name, value);
        }
      }
      headers.set('authorization', `Bearer ${TEST_ACCESS_TOKEN}`);
      headers.set('host', `${HOST}:${GEV_PORT}`);

      const upstream = await fetch(
        `${MCP_RESOURCE}${new URL(request.url ?? '/', MCP_RESOURCE).search}`,
        {
          method: request.method,
          headers,
          body: chunks.length === 0 ? undefined : Buffer.concat(chunks),
          signal: AbortSignal.timeout(30_000),
        }
      );
      const responseHeaders = Object.fromEntries(upstream.headers.entries());
      response.writeHead(upstream.status, responseHeaders);
      if (upstream.body === null) {
        response.end();
        return;
      }
      Readable.fromWeb(upstream.body).pipe(response);
    } catch (error) {
      response.writeHead(502, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'loopback proxy failure',
        })
      );
    }
  });
}

let exitCode = 0;
try {
  globalThis.fetch = (input, init) => {
    const target = new URL(input instanceof Request ? input.url : input);
    if (target.hostname !== HOST) {
      blockedNonLoopbackFetches += 1;
      throw new Error(`Task 6.5 seed harness blocked non-loopback fetch to ${target.hostname}`);
    }
    return originalFetch(input, init);
  };
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'gev-mcp-conformance-'));
  conformanceOutput = path.join(temporaryDirectory, 'official-conformance');
  inspectorConfig = path.join(temporaryDirectory, 'inspector-session.json');
  await fs.writeFile(
    inspectorConfig,
    JSON.stringify(
      {
        mcpServers: {
          gevTask65: {
            type: 'streamable-http',
            url: MCP_RESOURCE,
            protocolEra: 'modern',
            headers: { Authorization: `Bearer ${TEST_ACCESS_TOKEN}` },
          },
        },
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
  created = createApp({
    clock: new FrozenClock(TEST_NOW_MS),
    mcpHttpEnabled: true,
    mcpHttpBearerVerifier: bearerVerifier,
    mcpHttpResponseMode: 'json',
  });
  gevServer = serve({
    fetch: created.app.fetch,
    hostname: HOST,
    port: GEV_PORT,
  });
  conformanceProxy = createConformanceProxy();
  if (!gevServer.listening) {
    await new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      gevServer.once('error', onError);
      gevServer.once('listening', () => {
        gevServer.off('error', onError);
        resolve();
      });
    });
  }
  await listen(conformanceProxy, CONFORMANCE_PROXY_PORT);

  console.log(`MCP Inspector ${INSPECTOR_VERSION} (MIT): authenticated loopback tools/list`);
  const inspectorResult = await runNode(
    'MCP Inspector',
    path.join(
      ROOT,
      'node_modules',
      '@modelcontextprotocol',
      'inspector',
      'clients',
      'launcher',
      'build',
      'index.js'
    ),
    [
      '--cli',
      '--config',
      inspectorConfig,
      '--server',
      'gevTask65',
      '--method',
      'tools/list',
      '--strict',
      '--format',
      'json',
    ]
  );
  const inspectorReport = JSON.parse(inspectorResult.stdout);
  const inspectorTools = inspectorReport.result?.tools;
  const inspectorErrors = (inspectorReport.schemaFindings ?? []).filter(
    (finding) => finding.severity === 'error'
  );
  if (
    !Array.isArray(inspectorTools) ||
    inspectorTools.length !== 7 ||
    inspectorErrors.length !== 0
  ) {
    throw new Error(
      `MCP Inspector returned ${String(inspectorTools?.length)} tools and ${String(inspectorErrors.length)} schema errors`
    );
  }
  console.log(
    `PASS — ${String(inspectorTools.length)} tools, 0 schema errors, ${String(
      inspectorReport.schemaFindings?.length ?? 0
    )} advisory findings`
  );

  console.log(
    `MCP Conformance ${CONFORMANCE_VERSION} (MIT): ${
      requestedScenario ?? 'advertised GEV surface for protocol 2026-07-28'
    }`
  );
  console.log(
    'The loopback proxy injects only the deterministic test bearer and canonical Host; auth failure coverage remains in the GEV server test matrix.'
  );
  console.log(
    'The frozen requirements profile is an everything-server profile; GEV runs only official scenarios applicable to its advertised tools-only, no-subscription surface.'
  );
  const conformanceEntry = path.join(
    ROOT,
    'node_modules',
    '@modelcontextprotocol',
    'conformance',
    'dist',
    'index.js'
  );
  const scenarios = requestedScenario ? [requestedScenario] : ADVERTISED_SURFACE_SCENARIOS;
  for (const scenario of scenarios) {
    await runNode(`MCP Conformance scenario ${scenario}`, conformanceEntry, [
      'server',
      '--url',
      `http://${HOST}:${CONFORMANCE_PROXY_PORT}/mcp`,
      '--scenario',
      scenario,
      '--spec-version',
      '2026-07-28',
      '--output-dir',
      path.join(conformanceOutput, scenario),
    ]);
    console.log(`PASS — ${scenario}`);
  }
  if (blockedNonLoopbackFetches !== 0) {
    throw new Error(`Seed guard blocked ${String(blockedNonLoopbackFetches)} provider fetches`);
  }
  console.log('PASS — GEV process attempted zero non-loopback/provider fetches');
} catch (error) {
  exitCode = 1;
  console.error(error instanceof Error ? error.message : error);
} finally {
  await created?.mcpHttp?.close();
  created?.governanceContext.close();
  await Promise.allSettled(
    [conformanceProxy, gevServer].filter(Boolean).map((server) => close(server))
  );
  if (temporaryDirectory) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
  globalThis.fetch = originalFetch;
}

process.exitCode = exitCode;
