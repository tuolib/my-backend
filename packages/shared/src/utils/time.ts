/**
 * 时间工具函数
 * 提供常用的日期操作
 */

/** 获取当前时间 */
export function now(): Date {
  return new Date();
}

/** 在指定日期上增加分钟数 */
export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

/** 在指定日期上增加天数 */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** 判断给定日期是否已过期（早于当前时间） */
export function isExpired(date: Date): boolean {
  return date.getTime() < Date.now();
}

/** 格式化为 ISO 8601 字符串 */
export function formatISO(date: Date): string {
  return date.toISOString();
}
