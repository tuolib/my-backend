/**
 * 内部服务调用 HTTP 客户端
 * 自动注入 X-Request-Id（透传 traceId）和 x-internal-token
 */
import { getConfig } from '../config';
import { getTraceId } from './request-context';

/** 封装 fetch，自动注入 traceId + internal token */
export async function internalFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const config = getConfig();
  const headers = new Headers(init.headers);

  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('X-Request-Id', getTraceId());
  headers.set('x-internal-token', config.internal.secret);

  return fetch(url, { ...init, headers });
}
