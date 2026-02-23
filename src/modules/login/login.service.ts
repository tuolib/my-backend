import { sign, verify } from 'hono/jwt';
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { db } from '@/db';
import { users } from '@/db/schema.ts';
import { redisIns } from '@/lib/redis.ts';
import type { LoginInput } from './login.schema.ts';
import {
  ACCESS_TOKEN_EXPIRATION,
  REFRESH_TOKEN_EXPIRATION,
  JWT_SECRET,
  REDIS_SESSION_PREFIX,
} from '@/middleware/auth-config.ts';

// 自定义错误类，便于 Controller 层捕获并返回正确的 HTTP 状态码
export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class LoginService {
  /**
   * 验证用户凭据并生成 JWT 令牌。
   */
  async authenticate(input: LoginInput) {
    // ... (此方法不变)
    const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);

    if (!user) {
      throw new AuthenticationError('邮箱或密码错误');
    }

    const isPasswordValid = await bcrypt.compare(input.password, user.passwordHash);

    if (!isPasswordValid) {
      throw new AuthenticationError('邮箱或密码错误');
    }

    if (!user.isActive) {
      throw new AuthenticationError('账户已被禁用，请联系管理员');
    }

    const sid =
      Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    await redisIns.set(`${REDIS_SESSION_PREFIX}${user.id}`, sid, {
      EX: REFRESH_TOKEN_EXPIRATION,
    });

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    const accessToken = await sign(
      {
        sub: user.id,
        email: user.email,
        sid,
        exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_EXPIRATION,
      },
      JWT_SECRET
    );

    const refreshToken = await sign(
      {
        sub: user.id,
        email: user.email,
        sid,
        exp: Math.floor(Date.now() / 1000) + REFRESH_TOKEN_EXPIRATION,
      },
      JWT_SECRET
    );

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
      },
    };
  }

  /**
   * 刷新 Access Token，并实现 Refresh Token 的滑动续期
   */
  async refreshToken(oldToken: string) {
    try {
      // 1. 验证旧的 Refresh Token
      const payload = await verify(oldToken, JWT_SECRET, 'HS256');
      const userId = payload.sub as string;
      const oldSid = payload.sid as string;

      // 2. 验证 Redis 中的 Session ID
      const currentSid = await redisIns.get(`${REDIS_SESSION_PREFIX}${userId}`);
      // 如果 Redis 里没值，或者 Token 里的 sid 跟 Redis 当前值对不上
      // 说明这个 RefreshToken 是旧的（可能已被轮转过），或者已被踢出
      if (!currentSid || oldSid !== currentSid) {
        throw new AuthenticationError('会话已失效，请重新登录');
      }

      // 3. 【关键】生成新的 Session ID (sid)
      // 改变 sid 会导致所有携带旧 sid 的 AccessToken 和 RefreshToken 立即失效
      const newSid =
        Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

      // 3. 签发新的 Access Token (短效)
      const newAccessToken = await sign(
        {
          sub: userId,
          email: payload.email,
          sid: newSid,
          exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_EXPIRATION,
        },
        JWT_SECRET
      );

      // 4. 【核心】签发新的 Refresh Token (长效)，实现续期
      const newRefreshToken = await sign(
        {
          sub: userId,
          email: payload.email,
          sid: newSid,
          exp: Math.floor(Date.now() / 1000) + REFRESH_TOKEN_EXPIRATION,
        },
        JWT_SECRET
      );

      // 6. 【核心】更新 Redis：存储新的 sid 并设置过期时间
      // 这一步原子性地废弃了所有旧 sid 相关的 Token
      await redisIns.set(`${REDIS_SESSION_PREFIX}${userId}`, newSid, {
        EX: REFRESH_TOKEN_EXPIRATION,
      });
      // 6. 返回新的双 Token
      return { accessToken: newAccessToken, refreshToken: newRefreshToken };
    } catch (error) {
      // 如果 verify 失败 (例如 token 过期)，会在这里被捕获
      throw new AuthenticationError('无效的刷新令牌或会话已过期');
    }
  }
}

export const loginService = new LoginService();
