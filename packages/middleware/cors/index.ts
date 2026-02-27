import { cors } from "hono/cors";
import type { AppEnv } from "@core/context";
import type { MiddlewareHandler } from "hono";

/** CORS 中间件 — 基于配置动态设置 */
export function corsMiddleware(origins: string[]): MiddlewareHandler<AppEnv> {
  return cors({
    origin: origins.length > 0 ? origins : "*",
    allowMethods: ["POST", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-Request-ID",
      "X-Trace-Id",
      "X-Timezone",
    ],
    exposeHeaders: ["X-Request-ID", "X-Trace-Id"],
    maxAge: 86400,
  });
}
