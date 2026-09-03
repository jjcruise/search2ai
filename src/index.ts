/**
 * search2ai: 自托管搜索网关。
 * - `search2ai/core`  纯库, 零框架依赖
 * - `search2ai/hono`  可 mount 的 Hono app / 一键从环境变量组装
 * 根入口同时导出两者。
 */
export * from './core/index.ts';
export * from './hono.ts';
export { version } from './version.ts';
