import { redisIns } from './redis.ts';
import { logger } from './logger.ts';

/**
 * 轻量 Redis 缓存工具。
 * 所有操作静默失败——缓存层永远不阻断主业务流程。
 */
export const cache = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await redisIns.get(key);
      return value ? (JSON.parse(value) as T) : null;
    } catch (err) {
      logger.warn('Cache GET failed', { key, error: String(err) });
      return null;
    }
  },

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await redisIns.set(key, JSON.stringify(value), { EX: ttlSeconds });
    } catch (err) {
      logger.warn('Cache SET failed', { key, error: String(err) });
    }
  },

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await redisIns.del(keys);
    } catch (err) {
      logger.warn('Cache DEL failed', { keys, error: String(err) });
    }
  },

  /**
   * 通过 SCAN 删除匹配 pattern 的所有 key（避免 KEYS 阻塞 Redis）。
   * 用于批量失效，如用户列表缓存的整体清除。
   */
  async delByPattern(pattern: string): Promise<void> {
    try {
      let cursor = '0';
      do {
        const result = await redisIns.scan(cursor, { MATCH: pattern, COUNT: 100 });
        cursor = result.cursor;
        if (result.keys.length > 0) {
          await redisIns.del(result.keys);
        }
      } while (cursor !== '0');
    } catch (err) {
      logger.warn('Cache DEL_BY_PATTERN failed', { pattern, error: String(err) });
    }
  },
};
