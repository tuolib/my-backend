import { sign, verify } from 'hono/jwt';
import * as bcrypt from 'bcrypt';
import { LoginRepository } from './login.repository.ts';
import type { LoginInput } from './login.schema.ts';
import {
  ACCESS_TOKEN_EXPIRATION,
  REFRESH_TOKEN_EXPIRATION,
  JWT_SECRET,
} from '@/middleware/auth-config.ts';

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

const generateSid = (): string =>
  Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

export class LoginService {
  async authenticate(input: LoginInput) {
    const user = await LoginRepository.findUserByEmail(input.email);

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

    const sid = generateSid();
    await LoginRepository.setSession(user.id, sid);
    await LoginRepository.updateLastLoginAt(user.id);

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
      user: { id: user.id, email: user.email },
    };
  }

  async refreshToken(oldToken: string) {
    try {
      const payload = await verify(oldToken, JWT_SECRET, 'HS256');
      const userId = payload.sub as string;
      const oldSid = payload.sid as string;

      const currentSid = await LoginRepository.getSession(userId);
      if (!currentSid || oldSid !== currentSid) {
        throw new AuthenticationError('会话已失效，请重新登录');
      }

      const newSid = generateSid();

      const newAccessToken = await sign(
        {
          sub: userId,
          email: payload.email,
          sid: newSid,
          exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_EXPIRATION,
        },
        JWT_SECRET
      );

      const newRefreshToken = await sign(
        {
          sub: userId,
          email: payload.email,
          sid: newSid,
          exp: Math.floor(Date.now() / 1000) + REFRESH_TOKEN_EXPIRATION,
        },
        JWT_SECRET
      );

      await LoginRepository.setSession(userId, newSid);

      return { accessToken: newAccessToken, refreshToken: newRefreshToken };
    } catch (error) {
      // 原有 bug 修复：不将 AuthenticationError 重新包装，保留原始消息
      if (error instanceof AuthenticationError) throw error;
      throw new AuthenticationError('无效的刷新令牌或会话已过期');
    }
  }
}

export const loginService = new LoginService();
