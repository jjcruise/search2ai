[简体中文](README.md) · **English**

# search2ai

A self-hosted search gateway for AI agents. One Perplexity-compatible search API in front of Search1API, Tavily, Brave, Exa, Serper, SerpApi, Google, SearXNG and more, with automatic fallback when a provider fails. Use it as a library, run it as an HTTP service, or plug it into Claude / Cursor as an MCP server.

- **One schema**: `title / url / snippet / date`, the Perplexity Search API shape. Switch providers without touching your code.
- **Fallback chain**: rate limits, timeouts and errors move on to the next provider; the response tells you who answered and who was skipped.
- **search / news / crawl** with your own keys (BYO key). No keyless scraping.
- **Library first**: the core has zero framework dependencies; HTTP and MCP are thin shells. TypeScript + Hono, the same code runs on Node, Cloudflare Workers, Bun and Docker.
- **Legacy mode kept**: the 0.2.x "swap the base URL to give any chat client web access" proxy is still here, mounted when `APIBASE` is set.

## Don't want to host anything? Use Search1API

[**Search1API**](https://www.search1api.com/?utm_source=search2ai) is the hosted search service that ships with this project: one key aggregating Google / Bing / DuckDuckGo, with news and page crawling, and 100 free credits on signup. search2ai puts it first in the default fallback chain. If you just need a search endpoint that works, use it directly.

## Quick start

Four ways in, ordered by how much you have to deploy.

### 1. As a library (nothing to deploy)

```bash
npm i search2ai
```

```ts
import { createGateway } from 'search2ai/core';

const gateway = createGateway({
  providers: {
    search1api: { apiKey: process.env.SEARCH1API_KEY! },
    tavily: { apiKey: process.env.TAVILY_KEY! },
  },
});

const { provider, results, warnings } = await gateway.search({ query: 'hono cloudflare workers', max_results: 5 });
// provider === 'search1api'; if it is rate limited the call falls back to tavily and `warnings` says why
```

`gateway.news()` and `gateway.crawl({ url })` work the same way.

### 2. As a local MCP server (nothing to deploy)

Claude Desktop / Cursor / Claude Code MCP config:

```json
{
  "mcpServers": {
    "search2ai": {
      "command": "npx",
      "args": ["-y", "search2ai", "mcp"],
      "env": { "SEARCH1API_KEY": "your_key" }
    }
  }
}
```

Exposes three tools: `search`, `news`, `crawl`.

### 3. As an HTTP service

```bash
SEARCH1API_KEY=your_key npx search2ai serve      # http://localhost:3014
```

```bash
curl http://localhost:3014/v1/search \
  -H 'Content-Type: application/json' \
  -d '{"query": "latest node.js lts", "max_results": 3}'
```

The same service exposes `/mcp` (Streamable HTTP); point remote MCP clients at `http://host:3014/mcp`.

**Cloudflare Workers**

```bash
git clone https://github.com/fatwang2/search2ai && cd search2ai
npm i
npx wrangler secret put SEARCH1API_KEY
npm run deploy
```

Bind a KV namespace named `CACHE` and set `CACHE_TTL` to enable result caching.

**Docker**

```bash
docker build -t search2ai .
docker run -p 3014:3014 -e SEARCH1API_KEY=your_key search2ai
```

### 4. Mounted inside your own Hono app

```ts
import { Hono } from 'hono';
import { createAppFromEnv } from 'search2ai/hono';

const app = new Hono();
app.route('/search', createAppFromEnv(process.env));   // /search/v1/search, /search/mcp ...
```

## API

### `POST /v1/search`

The request body follows the [Perplexity Search API](https://docs.perplexity.ai/api-reference/search-post) with two extensions:

| Field | Description |
| --- | --- |
| `query` | Required. A string, or an array of strings (queried in parallel, merged and deduplicated) |
| `max_results` | Default 10, max 50 |
| `country` | ISO 3166-1 alpha-2 |
| `search_domain_filter` | Restrict to these domains (max 20) |
| `search_language_filter` | ISO 639-1 language codes |
| `search_recency_filter` | `hour` / `day` / `week` / `month` / `year` |
| `search_after_date_filter` / `search_before_date_filter` | `YYYY-MM-DD` or `MM/DD/YYYY` |
| `max_tokens_per_page` | Cap on crawled content per result |
| `providers` | **Extension**: provider order for this request, overriding the default chain |
| `crawl_results` | **Extension**: fetch full content for the top N results into `content` |

Response:

```json
{
  "object": "search",
  "id": "9f2c…",
  "provider": "tavily",
  "results": [
    { "title": "…", "url": "https://…", "snippet": "…", "date": "2026-09-01", "content": "… (only when crawl_results > 0)" }
  ],
  "warnings": [
    { "provider": "search1api", "code": "rate_limit", "message": "search1api: HTTP 429", "status": 429 }
  ]
}
```

`provider` is the service that actually answered; `warnings` lists the providers skipped during fallback and why. There is no `warnings` field when everything went fine.

### Other endpoints

| Endpoint | Description |
| --- | --- |
| `POST /v1/news` | Same request and response as `/v1/search`, restricted to news sources |
| `POST /v1/crawl` | `{ "url": "https://…" }` → `{ "url", "title", "content", "links?" }` |
| `GET /v1/health` | Configured providers and the effective fallback chain per operation |
| `GET /openapi.json` | OpenAPI 3.1 document |
| `ALL /mcp` | MCP Streamable HTTP endpoint |

Errors are always `{ "error": { "message", "type", "code", "warnings?" } }`. `502` when every provider failed, `503` when no provider is configured for the operation.

## Configuration

Configure only the providers you use. Without `SEARCH_SERVICE`, the configured providers form the fallback chain in the default priority below.

| Provider | search | news | crawl | Environment variables |
| --- | :-: | :-: | :-: | --- |
| `search1api` | ✓ | ✓ | ✓ | `SEARCH1API_KEY` (optional `SEARCH1API_SERVICE` picks the underlying engine) |
| `tavily` | ✓ | ✓ | ✓ | `TAVILY_KEY` |
| `brave` | ✓ | ✓ |  | `BRAVE_KEY` |
| `exa` | ✓ | ✓ | ✓ | `EXA_KEY` |
| `serper` | ✓ | ✓ |  | `SERPER_KEY` |
| `serpapi` | ✓ | ✓ |  | `SERPAPI_KEY` |
| `google` | ✓ | ✓ |  | `GOOGLE_KEY` + `GOOGLE_CX` (max 10 results per call) |
| `searxng` | ✓ | ✓ |  | `SEARXNG_BASE_URL` (json format must be enabled) |
| `jina` |  |  | ✓ | `JINA_KEY`, or list `jina` in `CRAWL_SERVICE` |
| `firecrawl` |  |  | ✓ | `FIRECRAWL_KEY` or `FIRECRAWL_BASE_URL` (self-hosted) |

Every `*_KEY` also accepts the `*_API_KEY` spelling.

| Variable | Description |
| --- | --- |
| `SEARCH_SERVICE` | Comma-separated provider order, e.g. `search1api,tavily,serper`; `NEWS_SERVICE` / `CRAWL_SERVICE` override per operation |
| `MAX_RESULTS` / `CRAWL_RESULTS` | Default result count / default number of results to crawl |
| `FALLBACK_ON_EMPTY` | `true` to also fall back on empty results; by default only errors, rate limits and timeouts trigger fallback |
| `PROVIDER_TIMEOUT_MS` | Per-provider timeout, default 15000 |
| `CACHE_TTL` | Result cache in seconds, default 0 (off) |
| `AUTH_KEYS` | Comma-separated bearer keys; when set, `/v1/*` and `/mcp` require `Authorization: Bearer <key>` |
| `GL` / `HL` | Country and language for Google-style providers |

See [.env.template](.env.template) for the full template.

### Fallback semantics

- Providers are tried in chain order. Auth failures, rate limits (429), 4xx / 5xx, network errors and timeouts move on to the next provider and are recorded in `warnings`.
- Empty results count as a normal answer and do not trigger fallback unless `FALLBACK_ON_EMPTY` is set, so a rare query cannot burn the quota of the whole chain.
- A single request can override the order with the `providers` field.
- When everything fails the response is `502` and `warnings` carries the reason for every provider.

## Legacy mode: web access for any chat client

The 0.2.x feature lives on as an optional module. Set `APIBASE` and the gateway also mounts `/v1/chat/completions`, injecting `search` / `news` / `crawler` tools into the upstream model, which decides when to search. Point NextChat, Cherry Studio, Chatbox and similar clients at the gateway URL.

```
APIBASE=https://api.openai.com/v1      # same semantics as the OpenAI SDK baseURL, including the version segment
SEARCH1API_KEY=your_key
```

- True streaming: tokens are forwarded as they are generated, and the final answer after a search streams as well
- Client parameters (temperature, response_format, your own tools, …) pass through untouched; calls to the client's own tools are handed back as-is
- With `AUTH_KEYS` set, request keys must be in the list and the upstream uses `OPENAI_API_KEY`; Azure via `OPENAI_TYPE=azure` plus `RESOURCE_NAME` / `DEPLOY_NAME` / `API_VERSION` / `AZURE_API_KEY`
- Other OpenAI endpoints (`/v1/models`, embeddings, audio) are proxied to the upstream unchanged

**Upgrading from 0.2.x**: environment variables are unchanged. The start command is now `npx search2ai serve` (or `npm run build && npm start`), and the Workers entry is `src/worker.ts`. The Bing Search API was retired in August 2025; the `bing` and the defunct `duckduckgo` backends were removed and are ignored if they appear in a chain.

## Roadmap

- **v0.3 (current)**: TypeScript + Hono rewrite, core library, three endpoints, MCP, OpenAPI, 8 search + 5 crawl providers, fallback chain, CLI, Workers / Node / Docker
- **v0.4 reliability**: multiple keys per provider with rotation, health probes and circuit breaking, KV / Redis cache, usage logging, parallel multi-source merge and dedupe
- More providers welcome: implement the [`SearchProvider`](src/core/types.ts) interface and register it in [`providers/index.ts`](src/core/providers/index.ts)

## Development

```bash
npm i
npm test                    # vitest: fallback semantics, provider mappings, routes, MCP, chat proxy streaming
npm run typecheck
npm run build               # tsc → dist/ (ESM + d.ts)
npm run dev                 # node --watch src/cli.ts serve
cp .env.local.example .env.local && npm run test:e2e   # end-to-end with real keys
```

## Community

[Discord](https://discord.gg/AKXYq32Bxc) · <a href="https://www.buymeacoffee.com/fatwang2" target="_blank">Buy Me A Coffee</a>

MIT License
