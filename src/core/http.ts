/**
 * provider 共用的 HTTP 与字段处理工具。
 */
import { ProviderError, codeFromStatus, toProviderError } from './errors.ts';
import type { ProviderContext, RecencyFilter } from './types.ts';

export async function fetchJson<T = unknown>(
  ctx: ProviderContext,
  provider: string,
  url: string,
  init: RequestInit = {}
): Promise<T> {
  let res: Response;
  try {
    res = await ctx.fetch(url, { ...init, signal: ctx.signal });
  } catch (error) {
    throw toProviderError(provider, error, ctx.signal);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const suffix = detail ? ` ${detail.replace(/\s+/g, ' ').slice(0, 200)}` : '';
    throw new ProviderError(provider, codeFromStatus(res.status), `${provider}: HTTP ${res.status}${suffix}`, res.status);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new ProviderError(provider, 'upstream', `${provider}: invalid JSON response`, res.status);
  }
}

export const jsonHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
  'Content-Type': 'application/json',
  Accept: 'application/json',
  ...extra,
});

/** 构造 query string, 跳过 undefined / 空值 */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** 去掉 HTML 标签与多余空白(部分 provider 的 snippet 带 <b> 高亮) */
export function cleanText(v: unknown): string {
  return str(v)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** 尽力把各种日期表示归一为 YYYY-MM-DD; 相对时间("2 days ago")等无法解析时返回 undefined */
export function toIsoDate(v: unknown): string | undefined {
  if (v == null || v === '') return undefined;
  const s = str(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return undefined;
  const d = new Date(t);
  // 带时区的字符串(GMT / UTC / Z / +0000)按 UTC 取日期; 不带时区的("Jan 5, 2026")JS 按本地解析, 也按本地取回, 避免跨时区偏一天
  const hasTz = /(Z|GMT|UTC|[+-]\d{2}:?\d{2})\s*$/i.test(s);
  if (hasTz) return d.toISOString().slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** MM/DD/YYYY → YYYY-MM-DD; 已是 ISO 则原样返回 */
export function normalizeDateInput(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return v;
}

/** 无原生域名过滤参数的 provider 用 site: 操作符实现 */
export function withSiteFilter(query: string, domains?: string[]): string {
  if (!domains || domains.length === 0) return query;
  const sites = domains.map((d) => `site:${d}`).join(' OR ');
  return domains.length === 1 ? `${query} ${sites}` : `${query} (${sites})`;
}

/** Google 系 tbs=qdr:* 新鲜度参数 */
export function googleTbs(recency?: RecencyFilter): string | undefined {
  if (!recency) return undefined;
  return { hour: 'qdr:h', day: 'qdr:d', week: 'qdr:w', month: 'qdr:m', year: 'qdr:y' }[recency];
}

export function truncate(text: string, max?: number): string {
  if (!max || text.length <= max) return text;
  return text.slice(0, max);
}
