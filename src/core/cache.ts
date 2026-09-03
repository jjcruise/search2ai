import type { Cache } from './types.ts';

/** 进程内 TTL 缓存(Node / 单 isolate 内有效) */
export class MemoryCache implements Cache {
  private readonly store = new Map<string, { value: string; expires: number }>();
  private readonly maxEntries: number;
  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
  }

  async get(key: string): Promise<string | null> {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.expires <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return hit.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
  }
}

/** Cloudflare KV 命名空间的最小接口, 避免依赖 workers-types */
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export function kvCache(kv: KVLike, prefix = 'search2ai:'): Cache {
  return {
    get: (key) => kv.get(prefix + key),
    set: (key, value, ttlSeconds) => (ttlSeconds > 0 ? kv.put(prefix + key, value, { expirationTtl: Math.max(60, ttlSeconds) }) : Promise.resolve()),
  };
}
