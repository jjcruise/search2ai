/**
 * Exa: 神经搜索, /search 带 highlights 作为 snippet, /contents 抓取正文。https://docs.exa.ai
 */
import { fetchJson, jsonHeaders, str, toIsoDate } from '../http.ts';
import type { CrawlResult, ProviderContext, ProviderSearchParams, SearchProvider, SearchResult } from '../types.ts';

export interface ExaOptions {
  apiKey: string;
  baseUrl?: string;
}

interface ExaItem {
  title?: string;
  url?: string;
  publishedDate?: string;
  highlights?: string[];
  text?: string;
}

export function createExa(opts: ExaOptions): SearchProvider {
  const name = 'exa';
  const base = (opts.baseUrl ?? 'https://api.exa.ai').replace(/\/+$/, '');
  const headers = jsonHeaders({ 'x-api-key': opts.apiKey });

  async function run(category: string | undefined, p: ProviderSearchParams, ctx: ProviderContext): Promise<SearchResult[]> {
    const body: Record<string, unknown> = {
      query: p.query,
      type: 'auto',
      numResults: p.maxResults,
      contents: { highlights: { maxCharacters: 400, numSentences: 2 } },
    };
    if (category) body.category = category;
    if (p.domains?.length) body.includeDomains = p.domains;
    if (p.afterDate) body.startPublishedDate = `${p.afterDate}T00:00:00.000Z`;
    if (p.beforeDate) body.endPublishedDate = `${p.beforeDate}T23:59:59.999Z`;
    if (!p.afterDate && p.recency) {
      const days = { hour: 1, day: 1, week: 7, month: 30, year: 365 }[p.recency];
      body.startPublishedDate = new Date(Date.now() - days * 86_400_000).toISOString();
    }
    const data = await fetchJson<{ results?: ExaItem[] }>(ctx, name, `${base}/search`, { method: 'POST', headers, body: JSON.stringify(body) });
    return (data.results ?? []).slice(0, p.maxResults).map((i) => {
      const snippet = i.highlights?.length ? i.highlights.join(' ') : str(i.text).slice(0, 400);
      const r: SearchResult = { title: str(i.title), url: str(i.url), snippet };
      const date = toIsoDate(i.publishedDate);
      if (date) r.date = date;
      return r;
    });
  }

  return {
    name,
    search: (p, ctx) => run(undefined, p, ctx),
    news: (p, ctx) => run('news', p, ctx),
    async crawl(url, ctx): Promise<CrawlResult> {
      const data = await fetchJson<{ results?: ExaItem[] }>(ctx, name, `${base}/contents`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ urls: [url], text: true }),
      });
      const first = data.results?.[0];
      return { url: str(first?.url) || url, title: first?.title ? str(first.title) : undefined, content: str(first?.text) };
    },
  };
}
