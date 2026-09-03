/**
 * 测试工具: 可路由的 mock fetch、JSON / SSE 响应构造。
 */
export interface RecordedCall {
  url: URL;
  init: RequestInit;
  body: unknown;
  headers: Record<string, string>;
}

export type Route = (url: URL, call: RecordedCall) => Response | Promise<Response> | undefined;

export function mockFetch(route: Route): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(urlStr);
    let body: unknown;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? {}).forEach((v, k) => (headers[k.toLowerCase()] = v));
    const call: RecordedCall = { url, init: init ?? {}, body, headers };
    calls.push(call);
    if (init?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const res = await route(url, call);
    return res ?? new Response(JSON.stringify({ error: `no mock route for ${url}` }), { status: 404 });
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

export const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** 构造 OpenAI 风格 SSE 响应; 每个事件之间间隔 delayMs, 末尾自动补 [DONE] */
export function sse(events: Array<Record<string, unknown> | string>, delayMs = 0): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const e of events) {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        controller.enqueue(encoder.encode(typeof e === 'string' ? e : `data: ${JSON.stringify(e)}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

export const chunk = (delta: Record<string, unknown>, finish: string | null = null, extra: Record<string, unknown> = {}) => ({
  id: 'chatcmpl-x',
  object: 'chat.completion.chunk',
  created: 1,
  model: 'mock',
  choices: [{ index: 0, delta, finish_reason: finish }],
  ...extra,
});

/** 读取 SSE 响应, 返回 data 列表与首字节 / 总耗时 */
export async function readSse(res: Response): Promise<{ events: string[]; firstByteMs: number; totalMs: number; raw: string }> {
  const t0 = Date.now();
  let firstByteMs = -1;
  let raw = '';
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (firstByteMs < 0) firstByteMs = Date.now() - t0;
    raw += decoder.decode(value, { stream: true });
  }
  const events = raw
    .split('\n\n')
    .filter((e) => e.startsWith('data:'))
    .map((e) => e.slice(5).trim());
  return { events, firstByteMs, totalMs: Date.now() - t0, raw };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
