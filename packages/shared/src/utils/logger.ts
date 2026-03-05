/**
 * 结构化日志工具 — 零依赖，统一 JSON 输出
 *
 * 使用方式：
 *   import { createLogger } from '@repo/shared';
 *   const log = createLogger('stock');
 *   log.info('reserve completed', { skuId, quantity });
 *
 * 自动注入 traceId（来自 AsyncLocalStorage），无需手动传递
 */
import { getTraceId } from './request-context';

// ── 日志级别 ──

const LEVELS = {
  fatal: 60,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
  trace: 10,
} as const;

type LogLevel = keyof typeof LEVELS;

// ── 类型定义 ──

export interface Logger {
  fatal(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  debug(msg: string, fields?: Record<string, unknown>): void;
  trace(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

// ── 配置延迟加载（避免循环依赖） ──

let _cachedLevel: LogLevel | null = null;

function getLogLevel(): number {
  if (_cachedLevel === null) {
    const raw = process.env.LOG_LEVEL as LogLevel | undefined;
    _cachedLevel = raw && raw in LEVELS ? raw : 'info';
  }
  return LEVELS[_cachedLevel];
}

// ── JSON 格式化输出 ──

function formatJson(
  level: LogLevel,
  service: string,
  msg: string,
  fields: Record<string, unknown>,
): string {
  const traceId = getTraceId();
  const entry: Record<string, unknown> = {
    time: new Date().toISOString(),
    level,
    service,
    ...(traceId && { traceId }),
    msg,
    ...fields,
  };
  return JSON.stringify(entry);
}

// ── 核心写入 ──

function write(level: LogLevel, line: string): void {
  if (level === 'fatal' || level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

// ── Logger 工厂 ──

function createLoggerImpl(
  service: string,
  baseBindings: Record<string, unknown>,
): Logger {
  function log(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (LEVELS[level] < getLogLevel()) return;
    const merged = fields ? { ...baseBindings, ...fields } : { ...baseBindings };
    write(level, formatJson(level, service, msg, merged));
  }

  return {
    fatal: (msg, fields) => log('fatal', msg, fields),
    error: (msg, fields) => log('error', msg, fields),
    warn: (msg, fields) => log('warn', msg, fields),
    info: (msg, fields) => log('info', msg, fields),
    debug: (msg, fields) => log('debug', msg, fields),
    trace: (msg, fields) => log('trace', msg, fields),
    child(bindings: Record<string, unknown>): Logger {
      return createLoggerImpl(service, { ...baseBindings, ...bindings });
    },
  };
}

/** 创建结构化 logger 实例 */
export function createLogger(service: string): Logger {
  return createLoggerImpl(service, {});
}
