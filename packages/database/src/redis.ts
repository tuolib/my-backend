/**
 * Redis 连接封装（ioredis）
 * 通过 getConfig() 获取连接配置，禁止直接使用 process.env
 */
import Redis from 'ioredis';
import { getConfig } from '@repo/shared';

const config = getConfig();

export function createRedis(): Redis {
  return new Redis(config.redis.url, {
    maxRetriesPerRequest: 10,
    retryStrategy(times) {
      if (times > 10) return null;
      return Math.min(times * 500, 5000);
    },
    lazyConnect: true,
  });
}

/** 默认实例（大多数场景直接使用） */
export const redis = createRedis();
