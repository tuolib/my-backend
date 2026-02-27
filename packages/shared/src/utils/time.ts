/** 获取当前 ISO 8601 时间戳 */
export function now(): string {
  return new Date().toISOString();
}

/** 计算两个时间戳之间的毫秒差 */
export function elapsed(start: number): number {
  return Math.round(performance.now() - start);
}
