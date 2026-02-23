import { sign } from 'hono/jwt';
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { db } from '@/db';
import { users } from '@/db/schema';
import { redisIns } from '@/lib/redis';
import type { LoginInput } from './login.schema';
import { JWT_EXPIRATION, JWT_SECRET, REDIS_SESSION_PREFIX } from '@/middleware/auth-config';

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
   * 包含：数据库查询、密码哈希比对、Redis 会话管理、JWT 签发。
   */
  async authenticate(input: LoginInput) {
    // 1. 查询数据库获取用户信息 (使用 email)
    const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);

    if (!user) {
      // 安全提示：不要明确告知用户是“邮箱不存在”，防止邮箱枚举攻击
      throw new AuthenticationError('邮箱或密码错误');
    }

    // 2. 验证密码哈希
    const isPasswordValid = await bcrypt.compare(input.password, user.passwordHash);

    if (!isPasswordValid) {
      throw new AuthenticationError('邮箱或密码错误');
    }

    if (!user.isActive) {
      throw new AuthenticationError('账户已被禁用，请联系管理员');
    }

    // 3. 生成唯一的 Session ID (sid)
    const sid =
      Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    // 4. 【核心】写入 Redis，覆盖旧的 sid 实现单点登录 (SSO)
    await redisIns.set(`${REDIS_SESSION_PREFIX}${user.id}`, sid, {
      EX: JWT_EXPIRATION,
    });

    // 5. 更新最后登录时间
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    // 6. 签发 JWT (移除 username)
    const token = await sign(
      {
        sub: user.id, // 标准 JWT Subject 字段
        email: user.email, // 使用 email 替代 username
        sid,
        exp: Math.floor(Date.now() / 1000) + JWT_EXPIRATION,
      },
      JWT_SECRET
    );

    return {
      token,
      user: {
        id: user.id,
        email: user.email, // 返回的用户信息中也不再有 username
      },
    };
  }
}

export const loginService = new LoginService();
