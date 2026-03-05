/**
 * 管理员管理业务逻辑 — 创建、列表、更新、禁用/启用、重置密码
 * 仅超级管理员可操作
 */
import {
  hashPassword,
  generateId,
  createLogger,
  ConflictError,
  NotFoundError,
  ForbiddenError,
  ErrorCode,
} from '@repo/shared';
import * as adminRepo from '../repositories/admin.repo';
import type {
  CreateAdminInput,
  UpdateAdminInput,
  AdminListInput,
  AdminProfile,
} from '../types';

const log = createLogger('admin-manage');

function toProfile(admin: {
  id: string;
  username: string;
  realName: string | null;
  role: string;
  isSuper: boolean;
  status: string;
  phone: string | null;
  email: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}): AdminProfile & { phone: string | null; email: string | null } {
  return {
    id: admin.id,
    username: admin.username,
    realName: admin.realName,
    role: admin.role,
    isSuper: admin.isSuper,
    status: admin.status,
    phone: admin.phone,
    email: admin.email,
    lastLoginAt: admin.lastLoginAt,
    createdAt: admin.createdAt,
  };
}

/** 创建管理员 */
export async function create(input: CreateAdminInput) {
  const existing = await adminRepo.findByUsername(input.username);
  if (existing) {
    throw new ConflictError('用户名已存在');
  }

  const hashedPw = await hashPassword(input.password);
  const admin = await adminRepo.create({
    id: generateId(),
    username: input.username,
    password: hashedPw,
    realName: input.realName ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    role: input.role,
    isSuper: false,
    status: 'active',
    mustChangePassword: true,
  });

  log.info('admin created', { adminId: admin.id, username: admin.username });
  return toProfile(admin);
}

/** 管理员列表 */
export async function list(input: AdminListInput) {
  const { items, total } = await adminRepo.list(input);
  return {
    items: items.map(toProfile),
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total,
      totalPages: Math.ceil(total / input.pageSize),
    },
  };
}

/** 更新管理员信息 */
export async function update(input: UpdateAdminInput) {
  const admin = await adminRepo.findById(input.id);
  if (!admin) {
    throw new NotFoundError('管理员不存在', ErrorCode.ADMIN_NOT_FOUND);
  }
  if (admin.isSuper) {
    throw new ForbiddenError('不能修改超级管理员');
  }

  const updated = await adminRepo.updateById(input.id, {
    realName: input.realName,
    phone: input.phone,
    email: input.email,
    role: input.role,
  });

  log.info('admin updated', { adminId: input.id });
  return toProfile(updated!);
}

/** 启用/禁用管理员 */
export async function toggleStatus(id: string, status: 'active' | 'disabled') {
  const admin = await adminRepo.findById(id);
  if (!admin) {
    throw new NotFoundError('管理员不存在', ErrorCode.ADMIN_NOT_FOUND);
  }
  if (admin.isSuper) {
    throw new ForbiddenError('不能禁用超级管理员');
  }

  await adminRepo.updateById(id, { status });
  log.info('admin status changed', { adminId: id, status });
}

/** 重置管理员密码 */
export async function resetPassword(id: string, newPassword: string) {
  const admin = await adminRepo.findById(id);
  if (!admin) {
    throw new NotFoundError('管理员不存在', ErrorCode.ADMIN_NOT_FOUND);
  }
  if (admin.isSuper) {
    throw new ForbiddenError('不能重置超级管理员密码');
  }

  const hashedPw = await hashPassword(newPassword);
  await adminRepo.resetPassword(id, hashedPw);
  log.info('admin password reset', { adminId: id });
}
