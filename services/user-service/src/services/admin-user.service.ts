/**
 * 管理端用户管理业务逻辑 — 列表、详情、封禁/解封
 */
import { NotFoundError, ErrorCode, createLogger } from '@repo/shared';
import * as userRepo from '../repositories/user.repo';
import * as addressRepo from '../repositories/address.repo';
import * as orderClient from './order-client';
import type {
  UserProfile,
  AdminUserListInput,
  AdminUserDetailResult,
} from '../types';

const log = createLogger('admin-user');

function toProfile(user: {
  id: string;
  email: string;
  nickname: string | null;
  avatarUrl: string | null;
  phone: string | null;
  status: string;
  lastLogin: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): UserProfile {
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

/** 管理端用户列表 */
export async function list(input: AdminUserListInput) {
  const { items, total } = await userRepo.findAll(input);
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

/** 管理端用户详情（含地址列表 + 订单统计） */
export async function detail(userId: string): Promise<AdminUserDetailResult> {
  const user = await userRepo.findById(userId);
  if (!user) {
    throw new NotFoundError('用户不存在', ErrorCode.USER_NOT_FOUND);
  }

  const [addresses, orderStats] = await Promise.all([
    addressRepo.findByUserId(userId),
    orderClient.fetchUserOrderStats(userId),
  ]);

  return {
    user: toProfile(user),
    addresses: addresses.map((a) => ({
      id: a.id,
      label: a.label,
      recipient: a.recipient,
      phone: a.phone,
      province: a.province,
      city: a.city,
      district: a.district,
      address: a.address,
      postalCode: a.postalCode,
      isDefault: a.isDefault,
    })),
    orderStats,
  };
}

/** 封禁/解封用户 */
export async function toggleStatus(
  userId: string,
  status: 'active' | 'banned',
): Promise<void> {
  const user = await userRepo.findById(userId);
  if (!user) {
    throw new NotFoundError('用户不存在', ErrorCode.USER_NOT_FOUND);
  }

  await userRepo.updateById(userId, { status });
  log.info('user status changed', { userId, status });
}
