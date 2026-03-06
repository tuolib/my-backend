/**
 * Redis 连接封装（ioredis）
 * 通过 getConfig() 获取连接配置，禁止直接使用 process.env
 * 生产环境通过 Bitnami Redis Sentinel 自动发现 master
 * 开发环境直连 REDIS_URL
 */
import Redis from 'ioredis';
import { getConfig, createLogger } from '@repo/shared';

const config = getConfig();
const log = createLogger('redis');

export function createRedis(): Redis {
  const useSentinel = config.redis.sentinels.length > 0;

  if (useSentinel) {
    return new Redis({
      sentinels: config.redis.sentinels,
      name: config.redis.sentinelMaster,
      maxRetriesPerRequest: 10,
      sentinelRetryStrategy(times) {
        if (times > 10) return null;
        return Math.min(times * 500, 5000);
      },
      retryStrategy(times) {
        if (times > 10) return null;
        return Math.min(times * 500, 5000);
      },
    });
  }

  return new Redis(config.redis.url, {
    maxRetriesPerRequest: 10,
    retryStrategy(times) {
      if (times > 10) return null;
      return Math.min(times * 500, 5000);
    },
  });
}

/** 默认实例（大多数场景直接使用） */
export const redis = createRedis();

/**
 * 预热：确保 Redis 连接已建立 + DB 连接池已创建首个连接
 * 各服务在启动时调用，健康检查在预热完成后才返回 ready
 */
export async function warmupRedis(instance: Redis = redis): Promise<void> {
  await instance.ping();
  log.info('Redis connection warmed up');
}
