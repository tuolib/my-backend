/**
 * 结构化日志工具 — 零依赖，支持 JSON (生产) / 彩色文本 (开发) 双模式
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
let _cachedIsProd: boolean | null = null;

function getLogLevel(): number {
  if (_cachedLevel === null) {
    const raw = process.env.LOG_LEVEL as LogLevel | undefined;
    _cachedLevel = raw && raw in LEVELS ? raw : 'info';
  }
  return LEVELS[_cachedLevel];
}

function isProd(): boolean {
  if (_cachedIsProd === null) {
    _cachedIsProd = process.env.NODE_ENV === 'production';
  }
  return _cachedIsProd;
}

// ── 颜色（开发模式） ──

const COLORS: Record<LogLevel, string> = {
  fatal: '\x1b[41m\x1b[37m', // 白字红底
  error: '\x1b[31m',          // 红
  warn: '\x1b[33m',           // 黄
  info: '\x1b[36m',           // 青
  debug: '\x1b[90m',          // 灰
  trace: '\x1b[90m',          // 灰
};
const RESET = '\x1b[0m';

// ── 格式化输出 ──

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

function formatText(
  level: LogLevel,
  service: string,
  msg: string,
  fields: Record<string, unknown>,
): string {
  const traceId = getTraceId();
  const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const tag = level.toUpperCase().padEnd(5);
  const traceStr = traceId ? ` [${traceId.slice(0, 8)}]` : '';

  let extra = '';
  const keys = Object.keys(fields);
  if (keys.length > 0) {
    extra =
      ' ' +
      keys
        .map((k) => {
          const v = fields[k];
          return `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`;
        })
        .join(' ');
  }

  return `${time} ${COLORS[level]}${tag}${RESET} [${service}]${traceStr} ${msg}${extra}`;
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
  const format = isProd() ? formatJson : formatText;

  function log(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (LEVELS[level] < getLogLevel()) return;
    const merged = fields ? { ...baseBindings, ...fields } : { ...baseBindings };
    write(level, format(level, service, msg, merged));
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
