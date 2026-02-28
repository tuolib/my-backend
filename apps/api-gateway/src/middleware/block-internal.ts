/**
 * 拦截外部对 /internal/* 的访问
 * 内部 API 仅 Docker 内部网络可达，外部请求一律 403
 */
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '@repo/shared';
import { ForbiddenError } from '@repo/shared';

export function blockInternal(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.req.path.startsWith('/internal/')) {
      throw new ForbiddenError('Internal API not accessible externally');
    }
    return next();
  };
}
