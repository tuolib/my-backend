/**
 * jwt.ts 单元测试
 * 覆盖 Access Token / Refresh Token 的签发与验证
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import {
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from './jwt';
import { UnauthorizedError } from '../errors';

// 设置测试环境变量（getConfig 需要）
beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://localhost/test';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-key-min-16';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-key-min-16';
  process.env.JWT_ACCESS_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
});

describe('signAccessToken / verifyAccessToken', () => {
  test('签发合法 JWT 并能解析回 payload', async () => {
    const token = await signAccessToken({
      sub: 'user-123',
      email: 'test@example.com',
    });

    expect(token).toBeTruthy();
    expect(token.split('.')).toHaveLength(3);

    const payload = await verifyAccessToken(token);
    expect(payload.sub).toBe('user-123');
    expect(payload.email).toBe('test@example.com');
    expect(payload.jti).toBeTruthy();
    expect(payload.iat).toBeGreaterThan(0);
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  test('篡改 token 抛出 UnauthorizedError', async () => {
    const token = await signAccessToken({
      sub: 'user-123',
      email: 'test@example.com',
    });

    const tampered = token.slice(0, -5) + 'xxxxx';

    expect(verifyAccessToken(tampered)).rejects.toBeInstanceOf(
      UnauthorizedError
    );
  });

  test('完全无效的 token 抛出 UnauthorizedError', async () => {
    expect(verifyAccessToken('not-a-jwt')).rejects.toBeInstanceOf(
      UnauthorizedError
    );
  });
});

describe('signRefreshToken / verifyRefreshToken', () => {
  test('签发并验证 Refresh Token', async () => {
    const token = await signRefreshToken({ sub: 'user-456' });

    expect(token).toBeTruthy();
    expect(token.split('.')).toHaveLength(3);

    const payload = await verifyRefreshToken(token);
    expect(payload.sub).toBe('user-456');
    expect(payload.jti).toBeTruthy();
    expect(payload.iat).toBeGreaterThan(0);
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  test('用 Access Secret 签的 token 无法通过 Refresh 验证', async () => {
    const accessToken = await signAccessToken({
      sub: 'user-123',
      email: 'test@example.com',
    });

    expect(verifyRefreshToken(accessToken)).rejects.toBeInstanceOf(
      UnauthorizedError
    );
  });
});
