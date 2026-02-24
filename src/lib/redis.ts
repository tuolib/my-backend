import { createClient, type RedisClientType } from 'redis';
import { logger } from './logger.ts';

let redisClient: RedisClientType | undefined;

const getRedisClient = (): RedisClientType => {
  if (!redisClient) {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    logger.info('Connecting to Redis', { host: url.split('@')[1] || url });

    redisClient = createClient({
      url,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 20) {
            logger.error('Redis max reconnect attempts reached');
            return new Error('Too many retries.');
          }
          return Math.min(retries * 100, 3000);
        },
      },
    });

    redisClient.on('error', (err) => logger.error('Redis client error', { error: String(err) }));
    redisClient.on('connect', () => logger.info('Redis connected'));
    redisClient.on('reconnecting', () => logger.warn('Redis reconnecting'));
    redisClient.on('end', () => logger.info('Redis connection closed'));

    process.on('SIGINT', async () => {
      if (redisClient) await redisClient.quit();
      process.exit(0);
    });
  }
  return redisClient;
};

export const redisIns = getRedisClient();

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
