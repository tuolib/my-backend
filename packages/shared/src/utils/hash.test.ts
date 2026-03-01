/**
 * hash.ts 单元测试
 * 覆盖 Argon2id 密码哈希 + SHA-256
 */
import { describe, test, expect } from 'bun:test';
import { hashPassword, verifyPassword, sha256 } from './hash';

describe('hashPassword', () => {
  test('返回非空字符串，且不等于原密码', async () => {
    const password = 'MySecurePass123!';
    const hashed = await hashPassword(password);
    expect(hashed).toBeTruthy();
    expect(hashed).not.toBe(password);
  });

  test('相同密码两次哈希结果不同（随机 salt）', async () => {
    const password = 'TestPassword';
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);
    expect(hash1).not.toBe(hash2);
  });
});

describe('verifyPassword', () => {
  test('正确密码返回 true', async () => {
    const password = 'CorrectPassword!';
    const hashed = await hashPassword(password);
    const result = await verifyPassword(password, hashed);
    expect(result).toBe(true);
  });

  test('错误密码返回 false', async () => {
    const password = 'CorrectPassword!';
    const hashed = await hashPassword(password);
    const result = await verifyPassword('WrongPassword!', hashed);
    expect(result).toBe(false);
  });

  test('无效哈希返回 false', async () => {
    const result = await verifyPassword('password', 'invalid-hash');
    expect(result).toBe(false);
  });
});

describe('sha256', () => {
  test('返回 64 位 hex 字符串', () => {
    const result = sha256('hello');
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  test('相同输入返回相同输出', () => {
    const a = sha256('test-input');
    const b = sha256('test-input');
    expect(a).toBe(b);
  });

  test('不同输入返回不同输出', () => {
    const a = sha256('input-a');
    const b = sha256('input-b');
    expect(a).not.toBe(b);
  });
});
