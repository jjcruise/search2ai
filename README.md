**简体中文** · [English](README-EN.md)

# search2ai

给 AI Agent 用的自托管搜索网关。一个 Perplexity 兼容的搜索 API，背后接 Search1API、Tavily、Brave、Exa、Serper、SerpApi、Google、SearXNG 等多家服务，一家挂了自动切下一家。可以当库 `import`，可以当 HTTP 服务部署，也可以当 MCP server 接到 Claude、Cursor。

- **一套 schema**：`title / url / snippet / date`，照抄 Perplexity Search API，换 provider 不改一行代码
- **fallback 链**：限流、超时、报错自动切换下一家，响应里告诉你这次是谁答的、跳过了谁
- **search / news / crawl** 三种能力，自带 key（BYO key），不做免 key 爬虫
- **库优先**：核心零框架依赖，HTTP 与 MCP 只是薄壳；TypeScript + Hono，Node、Cloudflare Workers、Bun、Docker 同一份代码
- **兼容旧版**：0.2.x 的「换个 base URL 让客户端联网」代理仍在，配置 `APIBASE` 即挂载

## 不想部署？用 Search1API

[**Search1API**](https://www.search1api.com/?utm_source=search2ai) 是本项目配套的托管搜索服务：一个 key 聚合 Google / Bing / DuckDuckGo 等引擎，支持新闻与网页抓取，注册免费送 100 积分。search2ai 默认把它排在 fallback 链的第一位；只想要一个能用的搜索接口而不想维护服务的话，直接用它就够了。

## 快速开始

四种接入方式，按部署成本从低到高。

### 1. 作为库（零部署）

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
// provider === 'search1api'；若它限流则自动落到 tavily，warnings 里记录原因
```

`gateway.news()` 与 `gateway.crawl({ url })` 同理。

### 2. 作为 MCP server（本地，零部署）

Claude Desktop / Cursor / Claude Code 的 MCP 配置：

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

提供 `search`、`news`、`crawl` 三个工具。

### 3. 作为 HTTP 服务

```bash
SEARCH1API_KEY=your_key npx search2ai serve      # http://localhost:3014
```

```bash
curl http://localhost:3014/v1/search \
  -H 'Content-Type: application/json' \
  -d '{"query": "latest node.js lts", "max_results": 3}'
```

同一个服务同时提供 `/mcp`（Streamable HTTP），远程 MCP 客户端填 `http://host:3014/mcp` 即可。

**Cloudflare Workers**

```bash
git clone https://github.com/fatwang2/search2ai && cd search2ai
npm i
npx wrangler secret put SEARCH1API_KEY
npm run deploy
```

绑定名为 `CACHE` 的 KV 命名空间并设置 `CACHE_TTL`，即可开启结果缓存。

**Docker**

```bash
docker build -t search2ai .
docker run -p 3014:3014 -e SEARCH1API_KEY=your_key search2ai
```

### 4. 挂进你自己的 Hono 应用

```ts
import { Hono } from 'hono';
import { createAppFromEnv } from 'search2ai/hono';

const app = new Hono();
app.route('/search', createAppFromEnv(process.env));   // /search/v1/search、/search/mcp ...
```

## API

### `POST /v1/search`

请求体与 [Perplexity Search API](https://docs.perplexity.ai/api-reference/search-post) 一致，并增加了两个扩展字段：

| 字段 | 说明 |
| --- | --- |
| `query` | 必填。字符串，或字符串数组（并行查询后合并去重） |
| `max_results` | 默认 10，上限 50 |
| `country` | ISO 3166-1 两位国家码 |
| `search_domain_filter` | 只在这些域名内搜索，最多 20 个 |
| `search_language_filter` | ISO 639-1 语言码数组 |
| `search_recency_filter` | `hour` / `day` / `week` / `month` / `year` |
| `search_after_date_filter` / `search_before_date_filter` | `YYYY-MM-DD` 或 `MM/DD/YYYY` |
| `max_tokens_per_page` | 抓取正文时每条结果的长度上限 |
| `providers` | **扩展**：本次请求的 provider 顺序，覆盖默认 fallback 链 |
| `crawl_results` | **扩展**：对前 N 条结果抓取正文写入 `content` |

响应：

```json
{
  "object": "search",
  "id": "9f2c…",
  "provider": "tavily",
  "results": [
    { "title": "…", "url": "https://…", "snippet": "…", "date": "2026-09-01", "content": "…（仅 crawl_results > 0）" }
  ],
  "warnings": [
    { "provider": "search1api", "code": "rate_limit", "message": "search1api: HTTP 429", "status": 429 }
  ]
}
```

`provider` 是实际给出结果的服务，`warnings` 是 fallback 过程中被跳过的服务及原因；一切正常时没有 `warnings`。

### 其它端点

| 端点 | 说明 |
| --- | --- |
| `POST /v1/news` | 与 `/v1/search` 相同的请求与响应，限定新闻源 |
| `POST /v1/crawl` | `{ "url": "https://…" }` → `{ "url", "title", "content", "links?" }` |
| `GET /v1/health` | 已配置的 provider、各操作的 fallback 链 |
| `GET /openapi.json` | OpenAPI 3.1 文档 |
| `ALL /mcp` | MCP Streamable HTTP 端点 |

错误统一为 `{ "error": { "message", "type", "code", "warnings?" } }`。所有 provider 都失败时返回 `502`，没有任何 provider 可用时返回 `503`。

## 配置

只配置你要用的 provider。没有指定 `SEARCH_SERVICE` 时，已配置的 provider 按下面的默认优先级组成 fallback 链。

| Provider | search | news | crawl | 环境变量 |
| --- | :-: | :-: | :-: | --- |
| `search1api` | ✓ | ✓ | ✓ | `SEARCH1API_KEY`（可选 `SEARCH1API_SERVICE` 指定底层引擎） |
| `tavily` | ✓ | ✓ | ✓ | `TAVILY_KEY` |
| `brave` | ✓ | ✓ |  | `BRAVE_KEY` |
| `exa` | ✓ | ✓ | ✓ | `EXA_KEY` |
| `serper` | ✓ | ✓ |  | `SERPER_KEY` |
| `serpapi` | ✓ | ✓ |  | `SERPAPI_KEY` |
| `google` | ✓ | ✓ |  | `GOOGLE_KEY` + `GOOGLE_CX`（单次最多 10 条） |
| `searxng` | ✓ | ✓ |  | `SEARXNG_BASE_URL`（需开启 json 输出） |
| `jina` |  |  | ✓ | `JINA_KEY`，或把 `jina` 写进 `CRAWL_SERVICE` |
| `firecrawl` |  |  | ✓ | `FIRECRAWL_KEY` 或 `FIRECRAWL_BASE_URL`（自托管） |

以上 `*_KEY` 也接受 `*_API_KEY` 写法。

| 变量 | 说明 |
| --- | --- |
| `SEARCH_SERVICE` | 逗号分隔的 provider 顺序，如 `search1api,tavily,serper`；`NEWS_SERVICE` / `CRAWL_SERVICE` 可按操作覆盖 |
| `MAX_RESULTS` / `CRAWL_RESULTS` | 默认返回条数 / 默认抓取正文条数 |
| `FALLBACK_ON_EMPTY` | 设为 `true` 时空结果也切换下一家；默认只在报错、限流、超时时切换 |
| `PROVIDER_TIMEOUT_MS` | 单个 provider 超时，默认 15000 |
| `CACHE_TTL` | 结果缓存秒数，默认 0 关闭 |
| `AUTH_KEYS` | 逗号分隔的 Bearer key；配置后 `/v1/*` 与 `/mcp` 需要 `Authorization: Bearer <key>` |
| `GL` / `HL` | Google 系 provider 的国家与语言 |

完整模板见 [.env.template](.env.template)。

### fallback 语义

- 按链的顺序逐家尝试；鉴权失败、限流（429）、4xx / 5xx、网络错误、超时都会切到下一家，并写入 `warnings`
- 空结果默认视为正常返回，不切换；开启 `FALLBACK_ON_EMPTY` 后才切换，避免冷门词把整条链的额度烧光
- 单次请求可用 `providers` 字段临时指定顺序
- 全部失败返回 `502`，`warnings` 里有每一家的失败原因

## 兼容旧版：让不联网的客户端联网

0.2.x 的核心功能保留为可选模块：配置 `APIBASE` 后，网关额外挂载 `/v1/chat/completions`，向上游模型注入 `search` / `news` / `crawler` 三个工具，模型决定何时搜索。在 NextChat、Cherry Studio、Chatbox 等客户端里把 API 地址换成网关地址即可。

```
APIBASE=https://api.openai.com/v1      # 与 OpenAI SDK baseURL 语义一致，含版本段
SEARCH1API_KEY=your_key
```

- 真流式：文字边生成边输出，触发搜索后最终回答同样流式返回
- 透传客户端参数（temperature、response_format、自带 tools 等），模型调用客户端自己的工具时原样交还
- `AUTH_KEYS` 配置后请求 key 必须在列表中，上游改用 `OPENAI_API_KEY`；Azure 用 `OPENAI_TYPE=azure` 加 `RESOURCE_NAME` / `DEPLOY_NAME` / `API_VERSION` / `AZURE_API_KEY`
- 其它 OpenAI 端点（`/v1/models`、embeddings、audio）原样透传到上游

**从 0.2.x 升级**：环境变量不用改。启动命令由 `npm start` 变为 `npx search2ai serve`（或 `npm run build && npm start`），Workers 入口变为 `src/worker.ts`。Bing Search API 已于 2025 年 8 月退役，`bing` 与失效的 `duckduckgo` 后端已移除，链里出现它们会被忽略。

## 路线图

- **v0.3（当前）**：TypeScript + Hono 重写，核心库、三端点、MCP、OpenAPI、8 家搜索 + 5 家抓取 provider、fallback 链、CLI、Workers / Node / Docker
- **v0.4 可靠性**：同一 provider 多 key 轮换、健康探测与熔断、KV / Redis 缓存、用量日志、多源并行合并去重
- 更多 provider 欢迎 PR：实现 [`SearchProvider`](src/core/types.ts) 接口并在 [`providers/index.ts`](src/core/providers/index.ts) 登记即可

## 开发

```bash
npm i
npm test                    # vitest：fallback 语义、各 provider 映射、路由、MCP、聊天代理流式
npm run typecheck
npm run build               # tsc → dist/（ESM + d.ts）
npm run dev                 # node --watch src/cli.ts serve
cp .env.local.example .env.local && npm run test:e2e   # 真实 key 端到端
```

## 交流与支持

[Discord](https://discord.gg/AKXYq32Bxc) · <a href="https://www.buymeacoffee.com/fatwang2" target="_blank">Buy Me A Coffee</a>

MIT License
