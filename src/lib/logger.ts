import { AsyncLocalStorage } from 'node:async_hooks';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  time: string;
  msg: string;
  requestId?: string;
  [key: string]: unknown;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

// 每个异步请求链路共享同一个 requestId，无需手动传参
export const requestStorage = new AsyncLocalStorage<{ requestId: string }>();

const minLevel = (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info';
const isProd = process.env.NODE_ENV === 'production';

function write(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minLevel]) return;

  const requestId = requestStorage.getStore()?.requestId;
  const entry: LogEntry = { level, time: new Date().toISOString(), msg, requestId, ...meta };

  // 生产环境输出 JSON，供 ELK/Loki 采集；开发环境输出可读格式
  const line = isProd
    ? JSON.stringify(entry)
    : `[${entry.time}] ${level.toUpperCase().padEnd(5)} ${requestId ? `[${requestId.slice(0, 8)}] ` : ''}${msg}${meta ? ' ' + JSON.stringify(meta) : ''}`;

  // error/warn 写 stderr，其余写 stdout，避免混合到同一流
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(line + '\n');
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => write('debug', msg, meta),
  info:  (msg: string, meta?: Record<string, unknown>) => write('info',  msg, meta),
  warn:  (msg: string, meta?: Record<string, unknown>) => write('warn',  msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => write('error', msg, meta),
};
