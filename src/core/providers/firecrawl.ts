/**
 * Firecrawl: 仅抓取正文, 支持云端与自托管(FIRECRAWL_BASE_URL)。https://docs.firecrawl.dev
 */
import { fetchJson, jsonHeaders, str } from '../http.ts';
import type { CrawlResult, SearchProvider } from '../types.ts';

export interface FirecrawlOptions {
  apiKey?: string;
  baseUrl?: string;
}

export function createFirecrawl(opts: FirecrawlOptions = {}): SearchProvider {
  const name = 'firecrawl';
  const base = (opts.baseUrl ?? 'https://api.firecrawl.dev').replace(/\/+$/, '');
  const headers = jsonHeaders(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {});

  return {
    name,
    async crawl(url, ctx): Promise<CrawlResult> {
      const data = await fetchJson<{
        success?: boolean;
        data?: { markdown?: string; links?: string[]; metadata?: { title?: string; sourceURL?: string } };
      }>(ctx, name, `${base}/v1/scrape`, { method: 'POST', headers, body: JSON.stringify({ url, formats: ['markdown'] }) });
      const d = data.data ?? {};
      const result: CrawlResult = {
        url: str(d.metadata?.sourceURL) || url,
        title: d.metadata?.title ? str(d.metadata.title) : undefined,
        content: str(d.markdown),
      };
      if (Array.isArray(d.links)) result.links = d.links.filter((v) => typeof v === 'string');
      return result;
    },
  };
}
