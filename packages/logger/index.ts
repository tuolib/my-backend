import pino from 'pino';
import type { RuntimeConfig } from '@config/runtime';
import type { RequestContext } from '@core/context';

/** 日志级别类型 */
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

/** 创建应用 Logger */
export function createLogger(config: RuntimeConfig) {
  return pino({
    level: config.log.level,
    ...(config.server.env === 'development'
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

/** 应用 Logger 类型 */
export type AppLogger = ReturnType<typeof createLogger>;

/** 从请求上下文创建子 Logger（自动携带 traceId / requestId） */
export function createRequestLogger(logger: AppLogger, ctx: RequestContext): AppLogger {
  return logger.child({
    traceId: ctx.traceId,
    requestId: ctx.requestId,
    clientIp: ctx.clientIp,
  });
}
