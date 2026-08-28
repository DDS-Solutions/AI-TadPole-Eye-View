import { GevMcpServer } from './server.js';

export * from './server.js';
export * from './context.js';
export * from './tools.js';

// If executed directly as CLI or MCP worker, launch the server
const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('/ops-mcp/dist/index.js') ||
    process.argv[1].endsWith('\\ops-mcp\\dist\\index.js') ||
    process.argv[1].endsWith('ops-mcp'));

if (isMain) {
  const server = new GevMcpServer();
  server.start();
}
