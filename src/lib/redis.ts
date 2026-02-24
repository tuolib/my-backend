import { createClient, type RedisClientType } from 'redis';

// 架构师提示：定义一个单例，避免在 Hono 的路由中重复创建连接导致内存泄漏
let redisClient: RedisClientType | undefined;

/**
 * 获取 Redis 客户端单例。
 * 符合生产环境要求：通过环境变量配置、支持重连策略、集成了日志。
 */
const getRedisClient = (): RedisClientType => {
  if (!redisClient) {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    console.log(`⏳ 正在连接到 Redis: ${url.split('@')[1] || url}`);

    redisClient = createClient({
      url,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 20) {
            console.error('❌ Redis 重连次数过多，放弃连接');
            return new Error('Too many retries.');
          }
          return Math.min(retries * 100, 3000); // 指数退避
        },
      },
    });

    redisClient.on('error', (err) => console.error('Redis Client Error:', err));
    redisClient.on('connect', () => console.log('✅ 已成功连接到 Redis'));
    redisClient.on('reconnecting', () => console.log('⏳ 正在重新连接到 Redis...'));
    redisClient.on('end', () => console.log('🔌 Redis 连接已关闭'));

    // 优雅停机：在进程退出时主动断开连接
    process.on('SIGINT', async () => {
      if (redisClient) {
        await redisClient.quit();
      }
      process.exit(0);
    });
  }
  return redisClient;
};

export const redisIns = getRedisClient();

/**
 * 在应用启动时连接 Redis。
 * 建议在主文件 (e.g., index.ts) 的启动逻辑中调用。
 */
export const connectRedis = async () => {
  if (redisIns && !redisIns.isOpen) {
    await redisIns.connect();
  }
};

export const checkRedisReadiness = async () => {
  if (!redisIns.isOpen) {
    throw new Error('Redis is not connected');
  }
  await redisIns.ping();
};
