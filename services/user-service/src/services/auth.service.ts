/**
 * 认证业务逻辑 — 注册、登录、刷新、登出
 * 核心安全设计：
 *   - 邮箱不存在与密码错误返回同一错误码，防止邮箱枚举
 *   - Refresh Token Rotation：每次刷新后旧 token 立即失效
 *   - 登出时将 access token JTI 加入 Redis 黑名单
 */
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  sha256,
  generateId,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  ErrorCode,
} from '@repo/shared';
import { redis } from '@repo/database';
import * as userRepo from '../repositories/user.repo';
import * as tokenRepo from '../repositories/token.repo';
import type { RegisterInput, LoginInput, AuthResult, TokenPair, UserProfile } from '../types';

/** 从 User 行中提取不含密码的 profile */
function toProfile(user: { id: string; email: string; nickname: string | null; avatarUrl: string | null; phone: string | null; status: string; lastLogin: Date | null; createdAt: Date; updatedAt: Date }): UserProfile {
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
    phone: user.phone,
    status: user.status,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/** 签发双 token 并存储 refresh token hash */
async function issueTokens(userId: string, email: string): Promise<TokenPair> {
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({ sub: userId, email }),
    signRefreshToken({ sub: userId }),
  ]);

  // 解析 refresh token 获取过期时间
  const decoded = await verifyRefreshToken(refreshToken);
  const expiresAt = new Date(decoded.exp * 1000);

  // 存储 refresh token hash
  await tokenRepo.create({
    userId,
    tokenHash: sha256(refreshToken),
    expiresAt,
  });

  return { accessToken, refreshToken };
}

/** 注册 */
export async function register(input: RegisterInput): Promise<AuthResult> {
  // 1. 邮箱查重
  const existing = await userRepo.findByEmail(input.email);
  if (existing) {
    throw new ConflictError('该邮箱已被注册', ErrorCode.USER_ALREADY_EXISTS);
  }

  // 2. 密码哈希
  const hashedPassword = await hashPassword(input.password);

  // 3. 创建用户
  const user = await userRepo.create({
    id: generateId(),
    email: input.email,
    password: hashedPassword,
    nickname: input.nickname ?? null,
    status: 'active',
  });

  // 4. 签发 token
  const tokens = await issueTokens(user.id, user.email);

  return {
    user: toProfile(user),
    ...tokens,
  };
}

/** 登录 */
export async function login(input: LoginInput): Promise<AuthResult> {
  // 1. 查用户（邮箱不存在和密码错误返回同一错误码，防止枚举）
  const user = await userRepo.findByEmail(input.email);
  if (!user) {
    throw new UnauthorizedError('邮箱或密码错误', ErrorCode.INVALID_CREDENTIALS);
  }

  // 2. 验证密码
  const valid = await verifyPassword(input.password, user.password);
  if (!valid) {
    throw new UnauthorizedError('邮箱或密码错误', ErrorCode.INVALID_CREDENTIALS);
  }

  // 3. 检查用户状态
  if (user.status === 'suspended') {
    throw new ForbiddenError('账号已被封禁');
  }
  if (user.status === 'deleted') {
    throw new ForbiddenError('账号已被注销');
  }

  // 4. 签发 token
  const tokens = await issueTokens(user.id, user.email);

  // 5. 更新最后登录时间（不阻塞响应）
  userRepo.updateLastLogin(user.id).catch(() => {});

  return {
    user: toProfile(user),
    ...tokens,
  };
}

/** 刷新 token（Token Rotation） */
export async function refresh(refreshTokenStr: string): Promise<TokenPair> {
  // 1. 验证 refresh token JWT 签名和过期时间
  const payload = await verifyRefreshToken(refreshTokenStr);

  // 2. 查 DB 中的 refresh token 记录
  const hash = sha256(refreshTokenStr);
  const tokenRecord = await tokenRepo.findByHash(hash);

  if (!tokenRecord) {
    throw new UnauthorizedError('无效的刷新令牌', ErrorCode.TOKEN_REVOKED);
  }

  // 3. 检查是否已被撤销
  if (tokenRecord.revokedAt) {
    throw new UnauthorizedError('登录凭证已被撤销', ErrorCode.TOKEN_REVOKED);
  }

  // 4. 检查过期（双重检查，JWT 验证已处理但 DB 记录也需确认）
  if (tokenRecord.expiresAt < new Date()) {
    throw new UnauthorizedError('登录已过期，请重新登录', ErrorCode.TOKEN_EXPIRED);
  }

  // 5. 撤销旧 refresh token
  await tokenRepo.revoke(tokenRecord.id);

  // 6. 查用户获取 email（签发 access token 需要）
  const user = await userRepo.findById(payload.sub);
  if (!user) {
    throw new UnauthorizedError('用户不存在', ErrorCode.INVALID_CREDENTIALS);
  }

  // 7. 签发新的双 token
  return issueTokens(user.id, user.email);
}

/** 登出 */
export async function logout(
  userId: string,
  tokenJti: string,
  refreshTokenStr?: string
): Promise<void> {
  // 1. 将当前 access token 的 JTI 加入 Redis 黑名单（TTL = access token 最大有效期 900s）
  await redis.set(`user:session:blacklist:${tokenJti}`, '1', 'EX', 900);

  // 2. 如果提供了 refreshToken，撤销对应记录
  if (refreshTokenStr) {
    const hash = sha256(refreshTokenStr);
    const tokenRecord = await tokenRepo.findByHash(hash);
    if (tokenRecord && !tokenRecord.revokedAt) {
      await tokenRepo.revoke(tokenRecord.id);
    }
  }

  // 3. 撤销该用户所有未过期的 refresh token
  await tokenRepo.revokeAllByUser(userId);
}
