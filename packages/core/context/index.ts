import type { Context, Env } from "hono";
import type { AuthUser } from "@shared-types/auth";
import type { Nullable } from "@shared-types/common";

/** 请求上下文 */
export interface RequestContext {
  traceId: string;
  requestId: string;
  auth: Nullable<AuthUser>;
  startTime: number;
  clientIp: string;
  userAgent: string;
  locale: string;
  timezone: string;
}

/** Hono 变量绑定类型 */
export interface AppEnv extends Env {
  Variables: {
    requestId: string;
    traceId: string;
    auth: Nullable<AuthUser>;
    requestContext: RequestContext;
  };
}

/** 从 Hono Context 创建 RequestContext */
export function createRequestContext(c: Context<AppEnv>): RequestContext {
  const requestId = c.get("requestId") ?? crypto.randomUUID();
  const traceId = c.get("traceId") ?? c.req.header("X-Trace-Id") ?? requestId;

  return {
    traceId,
    requestId,
    auth: c.get("auth") ?? null,
    startTime: performance.now(),
    clientIp: c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? "unknown",
    userAgent: c.req.header("User-Agent") ?? "unknown",
    locale: c.req.header("Accept-Language")?.split(",")[0]?.trim() ?? "en",
    timezone: c.req.header("X-Timezone") ?? "UTC",
  };
}
