/**
 * Jina Reader: 仅抓取正文。https://jina.ai/reader
 */
import { fetchJson, str } from '../http.ts';
import type { CrawlResult, SearchProvider } from '../types.ts';

export interface JinaOptions {
  apiKey?: string;
  baseUrl?: string;
}

export function createJina(opts: JinaOptions = {}): SearchProvider {
  const name = 'jina';
  const base = (opts.baseUrl ?? 'https://r.jina.ai').replace(/\/+$/, '');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;

  return {
    name,
    async crawl(url, ctx): Promise<CrawlResult> {
      const data = await fetchJson<{ data?: { title?: string; url?: string; content?: string; links?: Record<string, string> } }>(
        ctx,
        name,
        `${base}/${url}`,
        { headers }
      );
      const d = data.data ?? {};
      const result: CrawlResult = { url: str(d.url) || url, title: d.title ? str(d.title) : undefined, content: str(d.content) };
      if (d.links && typeof d.links === 'object') result.links = Object.values(d.links).filter((v) => typeof v === 'string');
      return result;
    },
  };
}
