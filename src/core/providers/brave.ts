/**
 * Brave Search API: web 与 news 两个端点。https://api-dashboard.search.brave.com/app/documentation
 */
import { cleanText, fetchJson, qs, str, toIsoDate, withSiteFilter } from '../http.ts';
import type { ProviderContext, ProviderSearchParams, RecencyFilter, SearchProvider, SearchResult } from '../types.ts';

export interface BraveOptions {
  apiKey: string;
  country?: string;
  searchLang?: string;
  baseUrl?: string;
}

interface BraveItem {
  title?: string;
  url?: string;
  description?: string;
  page_age?: string;
  age?: string;
}

function freshness(recency?: RecencyFilter, after?: string, before?: string): string | undefined {
  if (after || before) {
    const from = after ?? '1970-01-01';
    const to = before ?? new Date().toISOString().slice(0, 10);
    return `${from}to${to}`;
  }
  if (!recency) return undefined;
  return { hour: 'pd', day: 'pd', week: 'pw', month: 'pm', year: 'py' }[recency];
}

export function createBrave(opts: BraveOptions): SearchProvider {
  const name = 'brave';
  const base = (opts.baseUrl ?? 'https://api.search.brave.com/res/v1').replace(/\/+$/, '');
  const headers = { Accept: 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': opts.apiKey };

  function url(path: string, p: ProviderSearchParams): string {
    return `${base}${path}${qs({
      q: withSiteFilter(p.query, p.domains),
      count: Math.min(p.maxResults, 20),
      country: p.country?.toUpperCase() ?? opts.country,
      search_lang: p.languages?.[0] ?? opts.searchLang,
      freshness: freshness(p.recency, p.afterDate, p.beforeDate),
    })}`;
  }

  function map(items: BraveItem[] | undefined, limit: number): SearchResult[] {
    return (items ?? []).slice(0, limit).map((i) => {
      const r: SearchResult = { title: str(i.title), url: str(i.url), snippet: cleanText(i.description) };
      const date = toIsoDate(i.page_age ?? i.age);
      if (date) r.date = date;
      return r;
    });
  }

  return {
    name,
    async search(p: ProviderSearchParams, ctx: ProviderContext) {
      const data = await fetchJson<{ web?: { results?: BraveItem[] } }>(ctx, name, url('/web/search', p), { headers });
      return map(data.web?.results, p.maxResults);
    },
    async news(p: ProviderSearchParams, ctx: ProviderContext) {
      const data = await fetchJson<{ results?: BraveItem[] }>(ctx, name, url('/news/search', p), { headers });
      return map(data.results, p.maxResults);
    },
  };
}
