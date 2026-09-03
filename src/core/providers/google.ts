/**
 * Google Programmable Search (Custom Search JSON API)。单次最多 10 条, 无独立新闻接口(用 sort=date 取最新)。
 * https://developers.google.com/custom-search/v1/overview
 */
import { fetchJson, qs, str, toIsoDate } from '../http.ts';
import type { ProviderContext, ProviderSearchParams, RecencyFilter, SearchProvider, SearchResult } from '../types.ts';

export interface GoogleOptions {
  apiKey: string;
  cx: string;
  gl?: string;
  hl?: string;
  baseUrl?: string;
}

interface GoogleItem {
  title?: string;
  link?: string;
  snippet?: string;
  pagemap?: { metatags?: Array<Record<string, string>> };
}

function dateRestrict(recency?: RecencyFilter): string | undefined {
  if (!recency) return undefined;
  return { hour: 'd1', day: 'd1', week: 'w1', month: 'm1', year: 'y1' }[recency];
}

function itemDate(i: GoogleItem): string | undefined {
  const tags = i.pagemap?.metatags?.[0];
  if (!tags) return undefined;
  return toIsoDate(tags['article:published_time'] ?? tags['og:updated_time'] ?? tags['date'] ?? tags['pubdate']);
}

export function createGoogle(opts: GoogleOptions): SearchProvider {
  const name = 'google';
  const base = (opts.baseUrl ?? 'https://www.googleapis.com/customsearch/v1').replace(/\/+$/, '');

  async function run(p: ProviderSearchParams, ctx: ProviderContext, sort?: string): Promise<SearchResult[]> {
    const limit = Math.min(p.maxResults, 10);
    // siteSearch 只支持单个域名; 多域名退化为 site: 操作符
    const single = p.domains?.length === 1 ? p.domains[0] : undefined;
    const q = single || !p.domains?.length ? p.query : `${p.query} (${p.domains.map((d) => `site:${d}`).join(' OR ')})`;
    const url = `${base}${qs({
      key: opts.apiKey,
      cx: opts.cx,
      q,
      num: limit,
      gl: p.country?.toLowerCase() ?? opts.gl,
      hl: p.languages?.[0] ?? opts.hl,
      dateRestrict: dateRestrict(p.recency),
      siteSearch: single,
      siteSearchFilter: single ? 'i' : undefined,
      sort,
    })}`;
    const data = await fetchJson<{ items?: GoogleItem[] }>(ctx, name, url);
    return (data.items ?? []).slice(0, limit).map((i) => {
      const r: SearchResult = { title: str(i.title), url: str(i.link), snippet: str(i.snippet) };
      const date = itemDate(i);
      if (date) r.date = date;
      return r;
    });
  }

  return {
    name,
    search: (p, ctx) => run(p, ctx),
    news: (p, ctx) => run(p, ctx, 'date'),
  };
}
