/**
 * Tavily: 面向 LLM 的搜索 API, 另有 /extract 抓取正文。https://docs.tavily.com
 */
import { fetchJson, jsonHeaders, str, toIsoDate } from '../http.ts';
import type { CrawlResult, ProviderContext, ProviderSearchParams, RecencyFilter, SearchProvider, SearchResult } from '../types.ts';

export interface TavilyOptions {
  apiKey: string;
  searchDepth?: 'basic' | 'advanced';
  baseUrl?: string;
}

interface TavilyItem {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string;
}

function timeRange(recency?: RecencyFilter): string | undefined {
  if (!recency) return undefined;
  return { hour: 'day', day: 'day', week: 'week', month: 'month', year: 'year' }[recency];
}

export function createTavily(opts: TavilyOptions): SearchProvider {
  const name = 'tavily';
  const base = (opts.baseUrl ?? 'https://api.tavily.com').replace(/\/+$/, '');
  const headers = jsonHeaders({ Authorization: `Bearer ${opts.apiKey}` });

  async function run(topic: 'general' | 'news', p: ProviderSearchParams, ctx: ProviderContext): Promise<SearchResult[]> {
    const body: Record<string, unknown> = {
      query: p.query,
      topic,
      max_results: Math.min(p.maxResults, 20),
      search_depth: opts.searchDepth ?? 'basic',
    };
    if (p.domains?.length) body.include_domains = p.domains;
    if (p.country) body.country = p.country;
    const tr = timeRange(p.recency);
    if (tr) body.time_range = tr;
    if (p.afterDate) body.start_date = p.afterDate;
    if (p.beforeDate) body.end_date = p.beforeDate;
    const data = await fetchJson<{ results?: TavilyItem[] }>(ctx, name, `${base}/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return (data.results ?? []).slice(0, p.maxResults).map((i) => {
      const r: SearchResult = { title: str(i.title), url: str(i.url), snippet: str(i.content) };
      const date = toIsoDate(i.published_date);
      if (date) r.date = date;
      return r;
    });
  }

  return {
    name,
    search: (p, ctx) => run('general', p, ctx),
    news: (p, ctx) => run('news', p, ctx),
    async crawl(url, ctx): Promise<CrawlResult> {
      const data = await fetchJson<{ results?: Array<{ url?: string; raw_content?: string }>; failed_results?: unknown[] }>(
        ctx,
        name,
        `${base}/extract`,
        { method: 'POST', headers, body: JSON.stringify({ urls: [url] }) }
      );
      const first = data.results?.[0];
      return { url: str(first?.url) || url, content: str(first?.raw_content) };
    },
  };
}
