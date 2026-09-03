/**
 * 从 zod schema 生成 OpenAPI 3.1 文档, 供 /openapi.json 使用。
 */
import { z } from 'zod';
import {
  CrawlRequestSchema,
  CrawlResponseSchema,
  ErrorResponseSchema,
  SearchRequestSchema,
  SearchResponseSchema,
} from '../core/schema.ts';

const json = (schema: z.ZodType) => z.toJSONSchema(schema, { target: 'openapi-3.0', unrepresentable: 'any' });

export function buildOpenApi(opts: { version: string; serverUrl?: string; chatProxy: boolean; secured: boolean }): Record<string, unknown> {
  const security = opts.secured ? [{ bearerAuth: [] }] : [];
  const errorRef = { $ref: '#/components/schemas/ErrorResponse' };
  const errorResponses = {
    '400': { description: 'Invalid request', content: { 'application/json': { schema: errorRef } } },
    '401': { description: 'Unauthorized', content: { 'application/json': { schema: errorRef } } },
    '502': { description: 'All providers failed', content: { 'application/json': { schema: errorRef } } },
    '503': { description: 'No provider configured', content: { 'application/json': { schema: errorRef } } },
  };
  const searchOp = (summary: string, description: string, tag: string) => ({
    summary,
    description,
    tags: [tag],
    security,
    requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SearchRequest' } } } },
    responses: {
      '200': { description: 'Search results', content: { 'application/json': { schema: { $ref: '#/components/schemas/SearchResponse' } } } },
      ...errorResponses,
    },
  });

  const paths: Record<string, unknown> = {
    '/v1/search': {
      post: searchOp(
        'Web search',
        'Perplexity Search API compatible request. Tries the configured providers in order and returns the first successful result set; skipped providers are listed in `warnings`.',
        'search'
      ),
    },
    '/v1/news': { post: searchOp('News search', 'Same request and response shape as /v1/search, restricted to news sources.', 'search') },
    '/v1/crawl': {
      post: {
        summary: 'Fetch page content',
        tags: ['crawl'],
        security,
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CrawlRequest' } } } },
        responses: {
          '200': { description: 'Extracted page content', content: { 'application/json': { schema: { $ref: '#/components/schemas/CrawlResponse' } } } },
          ...errorResponses,
        },
      },
    },
    '/v1/health': {
      get: {
        summary: 'Health and configured providers',
        tags: ['meta'],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/mcp': {
      post: {
        summary: 'MCP endpoint (Streamable HTTP)',
        description: 'Model Context Protocol server exposing search, news and crawl tools.',
        tags: ['mcp'],
        security,
        responses: { '200': { description: 'MCP response' } },
      },
    },
  };
  if (opts.chatProxy) {
    paths['/v1/chat/completions'] = {
      post: {
        summary: 'OpenAI-compatible chat completions with web search tools injected (legacy mode)',
        tags: ['chat'],
        security,
        responses: { '200': { description: 'Chat completion (JSON or SSE)' } },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'search2ai',
      version: opts.version,
      description: 'Self-hosted search gateway for AI agents. One Perplexity-compatible API over multiple search providers with fallback.',
    },
    servers: opts.serverUrl ? [{ url: opts.serverUrl }] : undefined,
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      schemas: {
        SearchRequest: json(SearchRequestSchema),
        SearchResponse: json(SearchResponseSchema),
        CrawlRequest: json(CrawlRequestSchema),
        CrawlResponse: json(CrawlResponseSchema),
        ErrorResponse: json(ErrorResponseSchema),
      },
    },
  };
}
