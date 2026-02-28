/**
 * 密码哈希 (Argon2id) + SHA-256 工具
 * Argon2id: 用于密码存储/验证
 * SHA-256: 用于 refresh token hash 等非密码场景
 */
import { hash, verify } from '@node-rs/argon2';

/** Argon2id 哈希密码 */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, {
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
}

/** 验证密码是否匹配 Argon2id 哈希 */
export async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  try {
    return await verify(hashedPassword, password);
  } catch {
    return false;
  }
}

/** SHA-256 哈希，返回 hex 字符串 */
export function sha256(input: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(input);
  return hasher.digest('hex');
}
