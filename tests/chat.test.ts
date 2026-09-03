/**
 * 兼容旧版聊天代理: 用 mock 上游验证真流式、工具回路、客户端工具交还与参数透传。
 */
import { describe, expect, it } from 'vitest';
import { createGateway } from '../src/core/gateway.ts';
import { createApp } from '../src/server/app.ts';
import { chunk, json, mockFetch, readSse, sse, type RecordedCall } from './helpers.ts';

const UPSTREAM = 'http://upstream.test/v1';

function build() {
  const upstreamSeen: Array<Record<string, unknown>> = [];
  let searchHits = 0;
  const { fetch } = mockFetch((url, call: RecordedCall) => {
    if (url.hostname === 'api.search1api.com') {
      searchHits++;
      return json({ results: [{ title: 'Mock result', link: 'https://example.com', snippet: 'mock snippet' }] });
    }
    if (url.pathname === '/v1/models') return json({ data: [{ id: 'mock' }] });
    if (url.pathname !== '/v1/chat/completions') return undefined;
    const body = call.body as { messages: Array<{ role: string; content: string }>; stream?: boolean };
    upstreamSeen.push(body as Record<string, unknown>);
    const lastUser = [...body.messages].reverse().find((m) => m.role === 'user')!;
    const hasToolResult = body.messages.some((m) => m.role === 'tool');
    const stream = !!body.stream;
    const q = lastUser.content;

    if (q === 'plain') {
      if (stream) return sse([chunk({ role: 'assistant', content: '' }), chunk({ content: 'Hello' }), chunk({ content: ' world' }), chunk({}, 'stop')], 120);
      return json({ id: 'x', choices: [{ index: 0, message: { role: 'assistant', content: 'Hello world' }, finish_reason: 'stop' }] });
    }
    if (q === 'needs search') {
      if (!hasToolResult) {
        if (stream) {
          return sse([
            chunk({ role: 'assistant', content: '' }),
            chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'search', arguments: '' } }] }),
            chunk({ tool_calls: [{ index: 0, function: { arguments: '{"que' } }] }),
            chunk({ tool_calls: [{ index: 0, function: { arguments: 'ry":"abc"}' } }] }),
            chunk({}, 'tool_calls'),
            { id: 'chatcmpl-x', object: 'chat.completion.chunk', created: 1, model: 'mock', choices: [], usage: { total_tokens: 1 } },
          ]);
        }
        return json({
          id: 'x',
          choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search', arguments: '{"query":"abc"}' } }] }, finish_reason: 'tool_calls' }],
        });
      }
      const toolMsg = body.messages.find((m) => m.role === 'tool')!;
      const ok = toolMsg.content.includes('Mock result');
      if (stream) return sse([chunk({ role: 'assistant', content: '' }), chunk({ content: ok ? 'Answer' : 'BAD' }), chunk({ content: ' after search' }), chunk({}, 'stop')]);
      return json({ id: 'x', choices: [{ index: 0, message: { role: 'assistant', content: ok ? 'Answer after search' : 'BAD' }, finish_reason: 'stop' }] });
    }
    if (q === 'client tool') {
      return sse([
        chunk({ role: 'assistant', content: '' }),
        chunk({ tool_calls: [{ index: 0, id: 'call_c', type: 'function', function: { name: 'get_weather', arguments: '{"city":"sh"}' } }] }),
        chunk({}, 'tool_calls'),
      ]);
    }
    return new Response('unknown scenario', { status: 400 });
  });
  const gateway = createGateway({ providers: { search1api: { apiKey: 'k' } }, fetch });
  const app = createApp({ gateway, fetch, chatProxy: { apiBase: UPSTREAM, type: 'openai', authKeys: [] } });
  const post = (payload: unknown) =>
    app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer client-key' },
      body: JSON.stringify(payload),
    });
  return { app, post, upstreamSeen, hits: () => searchHits };
}

describe('chat proxy (legacy mode)', () => {
  it('streams plain answers through immediately and passes params through', async () => {
    const { post, upstreamSeen } = build();
    const res = await post({ model: 'mock', stream: true, temperature: 0.3, messages: [{ role: 'user', content: 'plain' }] });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const { events, firstByteMs, totalMs } = await readSse(res);
    expect(firstByteMs).toBeLessThan(totalMs / 2);
    expect(events.filter((e) => e === '[DONE]')).toHaveLength(1);
    const text = events.filter((e) => e !== '[DONE]').map((e) => JSON.parse(e).choices[0].delta.content ?? '').join('');
    expect(text).toBe('Hello world');
    const b = upstreamSeen.at(-1)!;
    expect(b.temperature).toBe(0.3);
    expect(b.stream).toBe(true);
    expect((b.tools as Array<{ function: { name: string } }>).map((t) => t.function.name)).toEqual(['search', 'news', 'crawler']);
    expect(b.max_tokens).toBeUndefined();
  });

  it('executes gateway tools mid-stream and streams the final answer', async () => {
    const { post, upstreamSeen, hits } = build();
    const res = await post({ model: 'mock', stream: true, messages: [{ role: 'user', content: 'needs search' }] });
    const { events } = await readSse(res);
    const objs = events.filter((e) => e !== '[DONE]').map((e) => JSON.parse(e));
    expect(hits()).toBe(1);
    expect(objs.some((o) => o.choices?.[0]?.delta?.tool_calls)).toBe(false);
    expect(objs.some((o) => o.choices?.[0]?.finish_reason === 'tool_calls')).toBe(false);
    expect(objs.map((o) => o.choices?.[0]?.delta?.content ?? '').join('')).toBe('Answer after search');
    expect(events.filter((e) => e === '[DONE]')).toHaveLength(1);
    const second = upstreamSeen.at(-1)!;
    expect(second.tools).toBeDefined();
    const assistant = (second.messages as Array<Record<string, unknown>>).find((m) => m.role === 'assistant')!;
    expect((assistant.tool_calls as Array<{ function: { arguments: string } }>)[0].function.arguments).toBe('{"query":"abc"}');
    const toolMsg = (second.messages as Array<Record<string, unknown>>).find((m) => m.role === 'tool')!;
    expect(String(toolMsg.content)).toContain('"provider":"search1api"');
  });

  it('hands client-defined tool calls back to the client untouched', async () => {
    const { post, upstreamSeen } = build();
    const res = await post({
      model: 'mock',
      stream: true,
      tools: [{ type: 'function', function: { name: 'get_weather', parameters: { type: 'object', properties: {} } } }],
      messages: [{ role: 'user', content: 'client tool' }],
    });
    const { events } = await readSse(res);
    const objs = events.filter((e) => e !== '[DONE]').map((e) => JSON.parse(e));
    const tc = objs.find((o) => o.choices[0].delta.tool_calls);
    expect(tc.choices[0].delta.tool_calls[0].function.name).toBe('get_weather');
    expect(objs.some((o) => o.choices[0].finish_reason === 'tool_calls')).toBe(true);
    const names = (upstreamSeen.at(-1)!.tools as Array<{ function: { name: string } }>).map((t) => t.function.name);
    expect(names).toEqual(['get_weather', 'search', 'news', 'crawler']);
  });

  it('runs the tool loop for non-stream requests and passes response_format through', async () => {
    const { post, upstreamSeen, hits } = build();
    const res = await post({ model: 'mock', messages: [{ role: 'user', content: 'needs search' }], response_format: { type: 'text' } });
    expect(res.status).toBe(200);
    expect((await res.json()).choices[0].message.content).toBe('Answer after search');
    expect(hits()).toBe(1);
    expect(upstreamSeen[0].response_format).toEqual({ type: 'text' });
  });

  it('requires an Authorization header and passes other /v1 endpoints through', async () => {
    const { app } = build();
    const noAuth = await app.request('/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(noAuth.status).toBe(400);
    const models = await app.request('/v1/models', { headers: { Authorization: 'Bearer client-key' } });
    expect(models.status).toBe(200);
    expect(await models.json()).toEqual({ data: [{ id: 'mock' }] });
    const search = await app.request('/v1/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'x' }) });
    expect(search.status).toBe(200);
    expect((await search.json()).provider).toBe('search1api');
  });
});
