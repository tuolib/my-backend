import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "@core/context";
import type { AppLogger } from "@logger/index";

/** 请求日志中间件 — 记录请求/响应摘要 */
export function requestLoggerMiddleware(
  logger: AppLogger,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const start = performance.now();

    logger.info(
      {
        requestId: c.get("requestId"),
        method: c.req.method,
        path: c.req.path,
        userAgent: c.req.header("User-Agent"),
      },
      "Incoming request",
    );

    await next();

    const duration = Math.round(performance.now() - start);

    logger.info(
      {
        requestId: c.get("requestId"),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        duration,
      },
      "Request completed",
    );
  };
}
