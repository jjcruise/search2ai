#!/usr/bin/env node
/**
 * CLI:
 *   search2ai serve [--port 3014] [--host 0.0.0.0]   启动 HTTP 网关(含 /mcp)
 *   search2ai mcp                                    以 stdio 方式运行 MCP server(Claude Desktop / Cursor 等本地接入)
 * 环境变量从当前目录的 .env.local 与 .env 读取(已存在的变量不覆盖)。
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAppFromEnv, createGatewayFromEnv } from './hono.ts';
import { createMcpServer } from './mcp/server.ts';
import { version } from './version.ts';

function loadEnv(): void {
  for (const file of ['.env.local', '.env']) {
    const p = resolve(process.cwd(), file);
    if (!existsSync(p)) continue;
    try {
      process.loadEnvFile(p);
    } catch (error) {
      console.error(`Failed to load ${file}: ${(error as Error).message}`);
    }
  }
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  return fallback;
}

function usage(): void {
  console.log(`search2ai ${version}

Usage:
  search2ai serve [--port 3014] [--host 0.0.0.0]   Start the HTTP gateway (REST + MCP)
  search2ai mcp                                    Run the MCP server over stdio

Configure providers with environment variables (or a .env file), e.g.
  SEARCH1API_KEY=...  TAVILY_KEY=...  SEARCH_SERVICE=search1api,tavily
See https://github.com/fatwang2/search2ai for the full list.`);
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return usage();
  if (cmd === '--version' || cmd === '-v' || cmd === 'version') return console.log(version);
  loadEnv();

  if (cmd === 'serve') {
    const port = Number(arg('--port', process.env.PORT ?? '3014'));
    const hostname = arg('--host', process.env.HOST ?? '0.0.0.0');
    const app = createAppFromEnv(process.env);
    serve({ fetch: app.fetch, port, hostname }, (address) => {
      const gateway = createGatewayFromEnv(process.env);
      const chains = ['search', 'news', 'crawl'].map((op) => `${op}: ${gateway.chain(op as 'search').join(' → ') || '(none)'}`).join('  ');
      console.log(`search2ai ${version} listening on http://${address.address}:${address.port}`);
      console.log(`  ${chains}`);
      if (process.env.APIBASE || process.env.CHAT_PROXY) console.log(`  chat proxy: enabled (${process.env.APIBASE ?? 'https://api.openai.com/v1'})`);
    });
    return;
  }

  if (cmd === 'mcp') {
    const gateway = createGatewayFromEnv(process.env);
    const server = createMcpServer(gateway, version);
    await server.connect(new StdioServerTransport());
    return;
  }

  console.error(`Unknown command: ${cmd}\n`);
  usage();
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
