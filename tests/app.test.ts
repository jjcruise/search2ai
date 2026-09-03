import { describe, expect, it } from 'vitest';
import { createGateway } from '../src/core/gateway.ts';
import { createApp } from '../src/server/app.ts';
import { createAppFromEnv } from '../src/hono.ts';
import { json, mockFetch } from './helpers.ts';

function build(authKeys: string[] = []) {
  const { fetch, calls } = mockFetch((url) => {
    if (url.hostname === 'api.search1api.com' && url.pathname === '/search') return json({ results: [{ title: 'A', link: 'https://a.com', snippet: 's' }] });
    if (url.hostname === 'api.search1api.com' && url.pathname === '/news') return json({ results: [{ title: 'N', link: 'https://n.com', snippet: 'n' }] });
    if (url.hostname === 'api.search1api.com' && url.pathname === '/crawl') return json({ results: { title: 'P', link: 'https://p.com', content: 'c' } });
    return undefined;
  });
  const gateway = createGateway({ providers: { search1api: { apiKey: 'k' } }, fetch });
  const app = createApp({ gateway, authKeys, fetch });
  return { app, calls };
}

const post = (app: ReturnType<typeof build>['app'], path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('HTTP app', () => {
  it('serves search / news / crawl', async () => {
    const { app } = build();
    const s = await post(app, '/v1/search', { query: 'x', max_results: 3 });
    expect(s.status).toBe(200);
    expect(await s.json()).toMatchObject({ object: 'search', provider: 'search1api', results: [{ url: 'https://a.com' }] });
    const n = await post(app, '/v1/news', { query: 'x' });
    expect((await n.json()).results[0].url).toBe('https://n.com');
    const c = await post(app, '/v1/crawl', { url: 'https://p.com' });
    expect(await c.json()).toMatchObject({ object: 'crawl', content: 'c' });
  });

  it('validates request bodies with useful messages', async () => {
    const { app } = build();
    const r = await post(app, '/v1/search', { max_results: 3 });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error.type).toBe('invalid_request');
    expect(body.error.message).toContain('query');
    const bad = await post(app, '/v1/crawl', { url: 'not a url' });
    expect(bad.status).toBe(400);
    const badJson = await app.request('/v1/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    expect(badJson.status).toBe(400);
  });

  it('maps gateway errors to JSON with warnings', async () => {
    const { fetch } = mockFetch(() => new Response('nope', { status: 500 }));
    const app = createApp({ gateway: createGateway({ providers: { search1api: { apiKey: 'k' } }, fetch }) });
    const r = await post(app, '/v1/search', { query: 'x' });
    expect(r.status).toBe(502);
    expect(await r.json()).toMatchObject({ error: { type: 'all_providers_failed', code: 502, warnings: [{ provider: 'search1api', status: 500 }] } });
    const none = createApp({ gateway: createGateway({ providers: {} }) });
    expect((await post(none, '/v1/search', { query: 'x' })).status).toBe(503);
  });

  it('enforces bearer auth on /v1/* and /mcp but keeps health / openapi public', async () => {
    const { app } = build(['secret']);
    expect((await post(app, '/v1/search', { query: 'x' })).status).toBe(401);
    expect((await post(app, '/v1/search', { query: 'x' }, { Authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await post(app, '/v1/search', { query: 'x' }, { Authorization: 'Bearer SECRET' })).status).toBe(200);
    expect((await app.request('/mcp', { method: 'POST' })).status).toBe(401);
    expect((await app.request('/v1/health')).status).toBe(200);
    expect((await app.request('/openapi.json')).status).toBe(200);
    expect((await app.request('/')).status).toBe(200);
  });

  it('exposes health, info and openapi documents', async () => {
    const { app } = build();
    const health = await (await app.request('/v1/health')).json();
    expect(health).toMatchObject({ status: 'ok', chains: { search: ['search1api'] }, auth: 'none' });
    expect(health.providers[0]).toEqual({ name: 'search1api', capabilities: ['search', 'news', 'crawl'] });
    const doc = await (await app.request('/openapi.json')).json();
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/v1/search', '/v1/news', '/v1/crawl', '/mcp']));
    expect(doc.paths['/v1/chat/completions']).toBeUndefined();
    expect(doc.components.schemas.SearchRequest.properties.query).toBeDefined();
    const nf = await app.request('/nope');
    expect(nf.status).toBe(404);
    expect((await nf.json()).error.type).toBe('not_found');
  });

  it('answers MCP initialize and tools/list over streamable HTTP', async () => {
    const { app } = build();
    const rpc = (id: number, method: string, params: Record<string, unknown> = {}) =>
      app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      });
    const init = await rpc(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    expect(init.status).toBe(200);
    const initText = await init.text();
    expect(initText).toContain('search2ai');
    const list = await rpc(2, 'tools/list');
    expect(list.status).toBe(200);
    const text = await list.text();
    const payload = text.startsWith('event:') || text.startsWith('data:') ? JSON.parse(text.split('\n').find((l) => l.startsWith('data:'))!.slice(5)) : JSON.parse(text);
    const names = payload.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(['crawl', 'news', 'search']);
    const call = await rpc(3, 'tools/call', { name: 'search', arguments: { query: 'x' } });
    const callText = await call.text();
    expect(callText).toContain('https://a.com');
  });

  it('createAppFromEnv wires providers, auth and chat proxy from env', async () => {
    const app = createAppFromEnv({ SEARCH1API_KEY: 'k', AUTH_KEYS: 'a,b' });
    const info = await (await app.request('/')).json();
    expect(info.auth).toBe('bearer');
    expect(info.endpoints).not.toContain('/v1/chat/completions');
    const withProxy = createAppFromEnv({ SEARCH1API_KEY: 'k', APIBASE: 'https://api.openai.com/v1' });
    const info2 = await (await withProxy.request('/')).json();
    expect(info2.endpoints).toContain('/v1/chat/completions');
  });
});
