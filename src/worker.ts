/**
 * Cloudflare Workers 入口。环境变量与 secret 通过 env 注入; 绑定名为 CACHE 的 KV 命名空间即可开启结果缓存(配合 CACHE_TTL)。
 */
import type { Hono } from 'hono';
import { kvCache, type KVLike } from './core/cache.ts';
import { createAppFromEnv } from './hono.ts';

type WorkerEnv = Record<string, string | undefined> & { CACHE?: KVLike };

let cached: { app: Hono; env: WorkerEnv } | undefined;

function appFor(env: WorkerEnv): Hono {
  if (cached && cached.env === env) return cached.app;
  const kv = env.CACHE && typeof env.CACHE === 'object' && typeof env.CACHE.get === 'function' ? env.CACHE : undefined;
  const app = createAppFromEnv(env, kv ? { cache: kvCache(kv) } : {});
  cached = { app, env };
  return app;
}

export default {
  fetch(request: Request, env: WorkerEnv, ctx: unknown): Response | Promise<Response> {
    return appFor(env).fetch(request, env, ctx as never);
  },
};
