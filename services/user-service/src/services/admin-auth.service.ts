/**
 * 管理员认证业务逻辑 — 登录、修改密码
 * 安全设计：
 *   - 用户名不存在与密码错误返回同一错误码，防止枚举
 *   - 连续 5 次失败锁定 30 分钟
 *   - 首次登录强制改密（返回临时 token + mustChangePassword 标记）
 */
import {
  hashPassword,
  verifyPassword,
  signAdminAccessToken,
  createLogger,
  UnauthorizedError,
  ForbiddenError,
  BadRequestError,
  ErrorCode,
} from '@repo/shared';
import * as adminRepo from '../repositories/admin.repo';
import type { AdminLoginInput, AdminChangePasswordInput, AdminLoginResult, AdminProfile } from '../types';

const log = createLogger('admin-auth');

function toProfile(admin: {
  id: string;
  username: string;
  realName: string | null;
  role: string;
  isSuper: boolean;
  status: string;
  lastLoginAt: Date | null;
  createdAt: Date;
}): AdminProfile {
  return {
    id: admin.id,
    username: admin.username,
    realName: admin.realName,
    role: admin.role,
    isSuper: admin.isSuper,
    status: admin.status,
    lastLoginAt: admin.lastLoginAt,
    createdAt: admin.createdAt,
  };
}

/** 管理员登录 */
export async function login(input: AdminLoginInput): Promise<AdminLoginResult> {
  const admin = await adminRepo.findByUsername(input.username);
  if (!admin) {
    log.warn('admin login failed: username not found', { username: input.username });
    throw new UnauthorizedError('用户名或密码错误', ErrorCode.ADMIN_INVALID_CREDENTIALS);
  }

  // 检查锁定状态
  if (admin.lockedUntil && admin.lockedUntil > new Date()) {
    log.warn('admin login blocked: account locked', { adminId: admin.id });
    throw new ForbiddenError('账号已锁定，请稍后再试', ErrorCode.ADMIN_ACCOUNT_LOCKED);
  }

  // 检查账号状态
  if (admin.status === 'disabled') {
    log.warn('admin login blocked: account disabled', { adminId: admin.id });
    throw new ForbiddenError('账号已被禁用', ErrorCode.ADMIN_ACCOUNT_DISABLED);
  }

  // 验证密码
  const valid = await verifyPassword(input.password, admin.password);
  if (!valid) {
    log.warn('admin login failed: wrong password', { adminId: admin.id });
    await adminRepo.incrementLoginFail(admin.id, admin.loginFailCount);
    throw new UnauthorizedError('用户名或密码错误', ErrorCode.ADMIN_INVALID_CREDENTIALS);
  }

  // 签发 token
  const accessToken = await signAdminAccessToken({
    sub: admin.id,
    username: admin.username,
    role: admin.role,
    isSuper: admin.isSuper,
  });

  // 更新登录成功状态（不阻塞响应）
  adminRepo.updateLoginSuccess(admin.id).catch(() => {});

  log.info('admin login success', { adminId: admin.id, username: admin.username });

  return {
    admin: toProfile(admin),
    accessToken,
    mustChangePassword: admin.mustChangePassword,
  };
}

/** 修改密码（首次登录强制改密 / 主动改密） */
export async function changePassword(
  adminId: string,
  input: AdminChangePasswordInput,
): Promise<void> {
  const admin = await adminRepo.findById(adminId);
  if (!admin) {
    throw new UnauthorizedError('管理员不存在', ErrorCode.ADMIN_NOT_FOUND);
  }

  // 验证旧密码
  const valid = await verifyPassword(input.oldPassword, admin.password);
  if (!valid) {
    throw new UnauthorizedError('旧密码错误', ErrorCode.ADMIN_INVALID_CREDENTIALS);
  }

  // 新旧密码不能相同
  const same = await verifyPassword(input.newPassword, admin.password);
  if (same) {
    throw new BadRequestError('新密码不能与旧密码相同', ErrorCode.ADMIN_PASSWORD_SAME);
  }

  const hashedPassword = await hashPassword(input.newPassword);
  await adminRepo.updatePassword(admin.id, hashedPassword);

  log.info('admin password changed', { adminId: admin.id });
}
