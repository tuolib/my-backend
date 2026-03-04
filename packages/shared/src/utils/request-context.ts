/**
 * 请求上下文 — 基于 AsyncLocalStorage 透传 traceId
 * 用于 Service → Service 内部调用时自动携带 traceId，无需改变函数签名
 */
import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestContext {
  traceId: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/** 获取当前请求的 traceId，不在请求上下文中时返回空字符串 */
export function getTraceId(): string {
  return requestContext.getStore()?.traceId ?? '';
}
