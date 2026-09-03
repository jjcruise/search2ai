/**
 * SerpApi: Google 与 Google News 引擎。https://serpapi.com
 */
import { fetchJson, googleTbs, qs, str, toIsoDate, withSiteFilter } from '../http.ts';
import type { ProviderContext, ProviderSearchParams, SearchProvider, SearchResult } from '../types.ts';

export interface SerpapiOptions {
  apiKey: string;
  gl?: string;
  hl?: string;
  baseUrl?: string;
}

interface SerpapiItem {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
}

function map(items: SerpapiItem[] | undefined, limit: number): SearchResult[] {
  return (items ?? []).slice(0, limit).map((i) => {
    const r: SearchResult = { title: str(i.title), url: str(i.link), snippet: str(i.snippet) };
    const date = toIsoDate(i.date);
    if (date) r.date = date;
    return r;
  });
}

export function createSerpapi(opts: SerpapiOptions): SearchProvider {
  const name = 'serpapi';
  const base = (opts.baseUrl ?? 'https://serpapi.com').replace(/\/+$/, '');

  function url(engine: string, p: ProviderSearchParams): string {
    return `${base}/search.json${qs({
      engine,
      api_key: opts.apiKey,
      q: withSiteFilter(p.query, p.domains),
      num: engine === 'google' ? p.maxResults : undefined,
      gl: p.country?.toLowerCase() ?? opts.gl,
      hl: p.languages?.[0] ?? opts.hl,
      tbs: googleTbs(p.recency),
    })}`;
  }

  return {
    name,
    async search(p: ProviderSearchParams, ctx: ProviderContext) {
      const data = await fetchJson<{ organic_results?: SerpapiItem[] }>(ctx, name, url('google', p));
      return map(data.organic_results, p.maxResults);
    },
    async news(p: ProviderSearchParams, ctx: ProviderContext) {
      const data = await fetchJson<{ news_results?: SerpapiItem[] }>(ctx, name, url('google_news', p));
      return map(data.news_results, p.maxResults);
    },
  };
}
