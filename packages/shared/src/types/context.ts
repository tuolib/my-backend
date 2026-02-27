import type { Context, Env } from 'hono';
import type { Nullable, AuthUser } from './index';
import pino from 'pino';

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

/** 应用 Logger 类型 */
export type AppLogger = pino.Logger;

/** 从 Hono Context 创建 RequestContext */
export function createRequestContext(c: Context<AppEnv>): RequestContext {
  const requestId = c.get('requestId') ?? crypto.randomUUID();
  const traceId = c.get('traceId') ?? c.req.header('X-Trace-Id') ?? requestId;

  return {
    traceId,
    requestId,
    auth: c.get('auth') ?? null,
    startTime: performance.now(),
    clientIp: c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'unknown',
    userAgent: c.req.header('User-Agent') ?? 'unknown',
    locale: c.req.header('Accept-Language')?.split(',')[0]?.trim() ?? 'en',
    timezone: c.req.header('X-Timezone') ?? 'UTC',
  };
}

/** 创建应用 Logger */
export function createLogger(config: { level: string; env: string }) {
  return pino({
    level: config.level,
    ...(config.env === 'development'
      ? {
          transport: {
            target: 'pino/file',
            options: { destination: 1 },
          },
          formatters: {
            level: (label: string) => ({ level: label }),
          },
        }
      : {
          formatters: {
            level: (label: string) => ({ level: label }),
          },
          timestamp: pino.stdTimeFunctions.isoTime,
        }),
  });
}

/** 从请求上下文创建子 Logger（自动携带 traceId / requestId） */
export function createRequestLogger(logger: AppLogger, ctx: RequestContext): AppLogger {
  return logger.child({
    traceId: ctx.traceId,
    requestId: ctx.requestId,
    clientIp: ctx.clientIp,
  });
}
