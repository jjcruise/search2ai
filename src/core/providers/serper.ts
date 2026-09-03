/**
 * Serper: Google SERP API。https://serper.dev
 */
import { fetchJson, googleTbs, jsonHeaders, str, toIsoDate, withSiteFilter } from '../http.ts';
import type { ProviderContext, ProviderSearchParams, SearchProvider, SearchResult } from '../types.ts';

export interface SerperOptions {
  apiKey: string;
  gl?: string;
  hl?: string;
  baseUrl?: string;
}

interface SerperItem {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
}

function map(items: SerperItem[] | undefined, limit: number): SearchResult[] {
  return (items ?? []).slice(0, limit).map((i) => {
    const r: SearchResult = { title: str(i.title), url: str(i.link), snippet: str(i.snippet) };
    const date = toIsoDate(i.date);
    if (date) r.date = date;
    return r;
  });
}

export function createSerper(opts: SerperOptions): SearchProvider {
  const name = 'serper';
  const base = (opts.baseUrl ?? 'https://google.serper.dev').replace(/\/+$/, '');
  const headers = jsonHeaders({ 'X-API-KEY': opts.apiKey });

  function body(p: ProviderSearchParams): string {
    const b: Record<string, unknown> = {
      q: withSiteFilter(p.query, p.domains),
      num: p.maxResults,
      gl: p.country?.toLowerCase() ?? opts.gl,
      hl: p.languages?.[0] ?? opts.hl,
    };
    const tbs = googleTbs(p.recency);
    if (tbs) b.tbs = tbs;
    return JSON.stringify(b);
  }

  return {
    name,
    async search(p: ProviderSearchParams, ctx: ProviderContext) {
      const data = await fetchJson<{ organic?: SerperItem[] }>(ctx, name, `${base}/search`, { method: 'POST', headers, body: body(p) });
      return map(data.organic, p.maxResults);
    },
    async news(p: ProviderSearchParams, ctx: ProviderContext) {
      const data = await fetchJson<{ news?: SerperItem[] }>(ctx, name, `${base}/news`, { method: 'POST', headers, body: body(p) });
      return map(data.news, p.maxResults);
    },
  };
}
