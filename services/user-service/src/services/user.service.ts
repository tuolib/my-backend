/**
 * 用户资料业务逻辑 — 获取/更新 profile
 */
import { NotFoundError, ErrorCode } from '@repo/shared';
import * as userRepo from '../repositories/user.repo';
import type { UserProfile, UpdateUserInput } from '../types';

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

/** 获取用户资料 */
export async function getProfile(userId: string): Promise<UserProfile> {
  const user = await userRepo.findById(userId);
  if (!user) {
    throw new NotFoundError('用户不存在', ErrorCode.USER_NOT_FOUND);
  }
  return toProfile(user);
}

/** 更新用户资料 */
export async function updateProfile(
  userId: string,
  input: UpdateUserInput
): Promise<UserProfile> {
  const updateData: Record<string, unknown> = {};
  if (input.nickname !== undefined) updateData.nickname = input.nickname;
  if (input.avatarUrl !== undefined) updateData.avatarUrl = input.avatarUrl;
  if (input.phone !== undefined) updateData.phone = input.phone;

  // 无更新字段时直接返回当前 profile
  if (Object.keys(updateData).length === 0) {
    return getProfile(userId);
  }

  const user = await userRepo.updateById(userId, updateData as Parameters<typeof userRepo.updateById>[1]);
  if (!user) {
    throw new NotFoundError('用户不存在', ErrorCode.USER_NOT_FOUND);
  }
  return toProfile(user);
}
