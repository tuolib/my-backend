import Redis from 'ioredis';

export const redisClient = new Redis(process.env.REDIS_URL);
export async function getRedis(key: string) {
  return redisClient.get(key);
}
export async function setRedis(key: string, value: string) {
  return redisClient.set(key, value);
}

//
// import Redis from "ioredis";
// import type { RuntimeConfig } from "@config/runtime";
// import type { AppLogger } from "@logger/index";
//
// /** 创建 Redis 客户端 */
// export function createRedisClient(
//   config: RuntimeConfig,
//   logger: AppLogger,
// ): Redis {
//   const client = new Redis(config.redis.url, {
//     maxRetriesPerRequest: 3,
//     retryStrategy(times) {
//       if (times > 10) return null;
//       return Math.min(times * 200, 2000);
//     },
//     lazyConnect: true,
//   });
//
//   client.on("connect", () => logger.info("Redis connected"));
//   client.on("error", (err) => logger.error({ err }, "Redis error"));
//   client.on("close", () => logger.warn("Redis connection closed"));
//
//   return client;
// }
//
// /** 缓存操作工具 */
// export class CacheManager {
//   constructor(
//     private readonly redis: Redis,
//     private readonly logger: AppLogger,
//   ) {}
//
//   /** 读取缓存（自动 JSON 反序列化） */
//   async get<T = unknown>(key: string): Promise<T | null> {
//     const raw = await this.redis.get(key);
//     if (raw === null) return null;
//     try {
//       return JSON.parse(raw) as T;
//     } catch {
//       this.logger.warn({ key }, "Cache parse error, removing invalid entry");
//       await this.redis.del(key);
//       return null;
//     }
//   }
//
//   /** 写入缓存（自动 JSON 序列化） */
//   async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
//     const raw = JSON.stringify(value);
//     if (ttlSeconds) {
//       await this.redis.set(key, raw, "EX", ttlSeconds);
//     } else {
//       await this.redis.set(key, raw);
//     }
//   }
//
//   /** 删除缓存 */
//   async del(...keys: string[]): Promise<number> {
//     if (keys.length === 0) return 0;
//     return this.redis.del(...keys);
//   }
//
//   /** 判断 key 是否存在 */
//   async exists(key: string): Promise<boolean> {
//     return (await this.redis.exists(key)) === 1;
//   }
//
//   /** 批量读取缓存 */
//   async mget<T = unknown>(keys: string[]): Promise<(T | null)[]> {
//     if (keys.length === 0) return [];
//     const values = await this.redis.mget(...keys);
//     return values.map((v) => {
//       if (v === null) return null;
//       try {
//         return JSON.parse(v) as T;
//       } catch {
//         return null;
//       }
//     });
//   }
//
//   /** 自增（原子操作，常用于计数器/限流） */
//   async incr(key: string, ttlSeconds?: number): Promise<number> {
//     const val = await this.redis.incr(key);
//     if (ttlSeconds && val === 1) {
//       await this.redis.expire(key, ttlSeconds);
//     }
//     return val;
//   }
// }
//
