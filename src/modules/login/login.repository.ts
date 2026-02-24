import { redisIns } from '@/lib/redis.ts';
import { UserRepository } from '@/modules/users/user.repository.ts';
import { REDIS_SESSION_PREFIX, REFRESH_TOKEN_EXPIRATION } from '@/middleware/auth-config.ts';

export const LoginRepository = {
  // DB 操作：委托给 UserRepository，避免重复实现 Drizzle 查询
  findUserByEmail: UserRepository.findByEmail,
  updateLastLoginAt: UserRepository.updateLastLoginAt,
  createUser: UserRepository.create,

  // Redis 操作：session 生命周期管理
  async setSession(userId: number | string, sid: string) {
    await redisIns.set(`${REDIS_SESSION_PREFIX}${userId}`, sid, {
      EX: REFRESH_TOKEN_EXPIRATION,
    });
  },

  async getSession(userId: number | string): Promise<string | null> {
    return await redisIns.get(`${REDIS_SESSION_PREFIX}${userId}`);
  },
};
