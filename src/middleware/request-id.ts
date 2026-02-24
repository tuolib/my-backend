import { createMiddleware } from 'hono/factory';
import { requestStorage } from '@/lib/logger.ts';

/**
 * 请求 ID 中间件。
 * 1. 优先读取上游（如网关/LB）传入的 X-Request-ID，实现全链路追踪
 * 2. 若无，生成 UUID 作为本次请求的唯一标识
 * 3. 通过 AsyncLocalStorage 注入到整个异步调用链，所有 logger 调用自动携带
 * 4. 在响应头中透传，方便客户端关联日志
 */
export const requestIdMiddleware = createMiddleware(async (c, next) => {
  const requestId = c.req.header('X-Request-ID') ?? crypto.randomUUID();
  c.set('requestId', requestId);
  c.header('X-Request-ID', requestId);
  // run() 确保 next() 链路中的所有 logger 调用都能拿到 requestId
  await requestStorage.run({ requestId }, next);
});
