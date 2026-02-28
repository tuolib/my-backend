/**
 * 通用 HTTP 代理转发
 * Gateway 不解析请求 body，直接 stream 转发到下游服务
 * 注入 x-trace-id / x-user-id / x-user-email / x-internal-token 供下游使用
 */
import type { Context } from 'hono';
import type { AppEnv } from '@repo/shared';
import { getConfig } from '@repo/shared';
import { InternalError } from '@repo/shared';
import { ErrorCode } from '@repo/shared';

/** 转发请求到目标服务 */
export async function forwardRequest(
  c: Context<AppEnv>,
  targetBaseUrl: string
): Promise<Response> {
  const config = getConfig();
  const targetUrl = `${targetBaseUrl}${c.req.path}`;

  // 构建转发 headers
  const forwardHeaders = new Headers();

  // 复制原始请求关键 headers
  const contentType = c.req.header('Content-Type');
  if (contentType) forwardHeaders.set('Content-Type', contentType);

  const authorization = c.req.header('Authorization');
  if (authorization) forwardHeaders.set('Authorization', authorization);

  const idempotencyKey = c.req.header('X-Idempotency-Key');
  if (idempotencyKey) forwardHeaders.set('X-Idempotency-Key', idempotencyKey);

  // 注入网关 headers
  const traceId = c.get('traceId') ?? '';
  forwardHeaders.set('X-Request-Id', traceId);
  forwardHeaders.set('x-trace-id', traceId);
  forwardHeaders.set('x-user-id', c.get('userId') ?? '');
  forwardHeaders.set('x-user-email', c.get('userEmail') ?? '');
  forwardHeaders.set('x-internal-token', config.internal.secret);

  try {
    const response = await fetch(targetUrl, {
      method: c.req.method,
      headers: forwardHeaders,
      body: c.req.raw.body,
      // @ts-expect-error Bun supports duplex streaming
      duplex: 'half',
    });

    // 构建响应 — 复制下游响应 headers + 注入 traceId
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('X-Request-Id', traceId);

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch {
    // 下游不可达
    throw new InternalError(
      '服务暂不可用',
      ErrorCode.SERVICE_UNAVAILABLE
    );
  }
}
