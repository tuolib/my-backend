import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { envSchema } from './index';

describe('envSchema', () => {
  test('should fail when DATABASE_URL is missing', () => {
    const result = envSchema.safeParse({
      REDIS_URL: 'redis://localhost:6379',
      JWT_ACCESS_SECRET: 'test-secret-12345678',
      JWT_REFRESH_SECRET: 'test-refresh-secret-12345678',
    });
    expect(result.success).toBe(false);
  });

  test('should fail when REDIS_URL is missing', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost/test',
      JWT_ACCESS_SECRET: 'test-secret-12345678',
      JWT_REFRESH_SECRET: 'test-refresh-secret-12345678',
    });
    expect(result.success).toBe(false);
  });

  test('should fail when JWT_ACCESS_SECRET is too short', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost/test',
      REDIS_URL: 'redis://localhost:6379',
      JWT_ACCESS_SECRET: 'short',
      JWT_REFRESH_SECRET: 'test-refresh-secret-12345678',
    });
    expect(result.success).toBe(false);
  });

  test('should parse valid env with defaults', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost/test',
      REDIS_URL: 'redis://localhost:6379',
      JWT_ACCESS_SECRET: 'test-secret-12345678',
      JWT_REFRESH_SECRET: 'test-refresh-secret-12345678',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NODE_ENV).toBe('development');
      expect(result.data.API_GATEWAY_PORT).toBe(3000);
      expect(result.data.JWT_ACCESS_EXPIRES_IN).toBe('15m');
      expect(result.data.JWT_REFRESH_EXPIRES_IN).toBe('7d');
      expect(result.data.DB_POOL_MAX).toBe(20);
    }
  });

  test('should transform CORS_ORIGINS into array', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost/test',
      REDIS_URL: 'redis://localhost:6379',
      JWT_ACCESS_SECRET: 'test-secret-12345678',
      JWT_REFRESH_SECRET: 'test-refresh-secret-12345678',
      CORS_ORIGINS: 'http://localhost:3000,http://localhost:5173',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.CORS_ORIGINS).toEqual([
        'http://localhost:3000',
        'http://localhost:5173',
      ]);
    }
  });
});
