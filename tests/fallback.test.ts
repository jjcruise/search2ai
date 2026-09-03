import { describe, expect, it } from 'vitest';
import { GatewayError, ProviderError } from '../src/core/errors.ts';
import { runChain } from '../src/core/fallback.ts';
import type { ProviderContext, SearchProvider, SearchResult } from '../src/core/types.ts';

const r = (n: number): SearchResult[] => Array.from({ length: n }, (_, i) => ({ title: `t${i}`, url: `https://x/${i}`, snippet: '' }));

function provider(name: string, impl: (ctx: ProviderContext) => Promise<SearchResult[]>): SearchProvider {
  return { name, search: (_p, ctx) => impl(ctx) };
}

const opts = { fetch: globalThis.fetch, timeoutMs: 100, onEmpty: false };
const call = (p: SearchProvider, ctx: ProviderContext) => p.search!({ query: 'q', maxResults: 5 }, ctx);
const isEmpty = (v: SearchResult[]) => v.length === 0;

describe('runChain', () => {
  it('returns the first provider that succeeds', async () => {
    const a = provider('a', async () => r(2));
    const b = provider('b', async () => r(3));
    const out = await runChain([a, b], 'search', call, isEmpty, opts);
    expect(out.provider).toBe('a');
    expect(out.value).toHaveLength(2);
    expect(out.warnings).toEqual([]);
  });

  it('falls back on rate limit / auth / upstream errors and records warnings', async () => {
    const a = provider('a', async () => {
      throw new ProviderError('a', 'rate_limit', 'a: HTTP 429', 429);
    });
    const b = provider('b', async () => {
      throw new ProviderError('b', 'auth', 'b: HTTP 401', 401);
    });
    const c = provider('c', async () => r(1));
    const out = await runChain([a, b, c], 'search', call, isEmpty, opts);
    expect(out.provider).toBe('c');
    expect(out.warnings.map((w) => [w.provider, w.code, w.status])).toEqual([
      ['a', 'rate_limit', 429],
      ['b', 'auth', 401],
    ]);
  });

  it('treats a hung provider as timeout and moves on', async () => {
    const a = provider(
      'a',
      (ctx) =>
        new Promise<SearchResult[]>((_, reject) => {
          ctx.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        })
    );
    const b = provider('b', async () => r(1));
    const t0 = Date.now();
    const out = await runChain([a, b], 'search', call, isEmpty, { ...opts, timeoutMs: 50 });
    expect(out.provider).toBe('b');
    expect(out.warnings[0].code).toBe('timeout');
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('wraps unknown errors as network warnings', async () => {
    const a = provider('a', async () => {
      throw new TypeError('fetch failed');
    });
    const b = provider('b', async () => r(1));
    const out = await runChain([a, b], 'search', call, isEmpty, opts);
    expect(out.warnings[0]).toMatchObject({ provider: 'a', code: 'network' });
  });

  it('throws GatewayError 502 with all warnings when every provider fails', async () => {
    const a = provider('a', async () => {
      throw new ProviderError('a', 'upstream', 'a: HTTP 500', 500);
    });
    const b = provider('b', async () => {
      throw new ProviderError('b', 'network', 'b: ECONNRESET');
    });
    await expect(runChain([a, b], 'search', call, isEmpty, opts)).rejects.toMatchObject({
      status: 502,
      code: 'all_providers_failed',
      warnings: [{ provider: 'a' }, { provider: 'b' }],
    });
  });

  it('returns empty results without fallback by default', async () => {
    const a = provider('a', async () => []);
    const b = provider('b', async () => r(1));
    const out = await runChain([a, b], 'search', call, isEmpty, opts);
    expect(out.provider).toBe('a');
    expect(out.value).toEqual([]);
  });

  it('falls back on empty results when onEmpty is set, and returns the first empty result if all are empty', async () => {
    const a = provider('a', async () => []);
    const b = provider('b', async () => r(1));
    const out = await runChain([a, b], 'search', call, isEmpty, { ...opts, onEmpty: true });
    expect(out.provider).toBe('b');
    expect(out.warnings).toEqual([{ provider: 'a', code: 'empty', message: 'a: no results' }]);

    const c = provider('c', async () => []);
    const allEmpty = await runChain([a, c], 'search', call, isEmpty, { ...opts, onEmpty: true });
    expect(allEmpty.provider).toBe('c');
    expect(allEmpty.value).toEqual([]);
    expect(allEmpty.warnings.map((w) => w.provider)).toEqual(['a']);

    const failing = provider('f', async () => {
      throw new ProviderError('f', 'upstream', 'f: HTTP 500', 500);
    });
    const emptyThenError = await runChain([a, failing], 'search', call, isEmpty, { ...opts, onEmpty: true });
    expect(emptyThenError.provider).toBe('a');
    expect(emptyThenError.value).toEqual([]);
    expect(emptyThenError.warnings.map((w) => w.code)).toEqual(['empty', 'upstream']);
  });

  it('is a GatewayError instance for callers to map to HTTP', async () => {
    const a = provider('a', async () => {
      throw new ProviderError('a', 'upstream', 'boom', 500);
    });
    await expect(runChain([a], 'search', call, isEmpty, opts)).rejects.toBeInstanceOf(GatewayError);
  });
});
