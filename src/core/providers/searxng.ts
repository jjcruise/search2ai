/**
 * SearXNG: 自托管元搜索。需要在 settings.yml 的 search.formats 中开启 json。
 * https://docs.searxng.org
 */
import { fetchJson, qs, str, toIsoDate, withSiteFilter } from '../http.ts';
import type { ProviderContext, ProviderSearchParams, RecencyFilter, SearchProvider, SearchResult } from '../types.ts';

export interface SearxngOptions {
  baseUrl: string;
  language?: string;
}

interface SearxngItem {
  title?: string;
  url?: string;
  content?: string;
  publishedDate?: string;
}

function timeRange(recency?: RecencyFilter): string | undefined {
  if (!recency) return undefined;
  return { hour: 'day', day: 'day', week: 'week', month: 'month', year: 'year' }[recency];
}

export function createSearxng(opts: SearxngOptions): SearchProvider {
  const name = 'searxng';
  const base = opts.baseUrl.replace(/\/+$/, '');

  async function run(categories: string, p: ProviderSearchParams, ctx: ProviderContext): Promise<SearchResult[]> {
    const url = `${base}/search${qs({
      q: withSiteFilter(p.query, p.domains),
      format: 'json',
      categories,
      language: p.languages?.[0] ?? opts.language,
      time_range: timeRange(p.recency),
    })}`;
    const data = await fetchJson<{ results?: SearxngItem[] }>(ctx, name, url, { headers: { Accept: 'application/json' } });
    return (data.results ?? []).slice(0, p.maxResults).map((i) => {
      const r: SearchResult = { title: str(i.title), url: str(i.url), snippet: str(i.content) };
      const date = toIsoDate(i.publishedDate);
      if (date) r.date = date;
      return r;
    });
  }

  return {
    name,
    search: (p, ctx) => run('general', p, ctx),
    news: (p, ctx) => run('news', p, ctx),
  };
}
