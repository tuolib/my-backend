/**
 * User Service HTTP 客户端
 * 封装对 user-service 内部接口的调用
 * 用于获取收货地址信息
 */
import { getConfig, internalFetch, createLogger } from '@repo/shared';
import type { UserAddressDetail, AdminOrderUserInfo } from '../types';

const config = getConfig();
const USER_SERVICE_URL = config.services.userUrl;
const log = createLogger('user-client');

/** 根据用户 ID 获取用户基本信息（供管理端订单详情使用） */
export async function fetchUserInfo(userId: string): Promise<AdminOrderUserInfo | null> {
  const res = await internalFetch(`${USER_SERVICE_URL}/internal/user/detail`, {
    method: 'POST',
    body: JSON.stringify({ id: userId }),
  });

  if (!res.ok) {
    log.error('user info fetch failed', { status: res.status, userId });
    return null;
  }

  const json = (await res.json()) as {
    success: boolean;
    data: { id: string; email: string; nickname: string | null; phone: string | null; status: string } | null;
  };
  if (!json.data) return null;

  return {
    id: json.data.id,
    email: json.data.email,
    nickname: json.data.nickname,
    phone: json.data.phone,
    status: json.data.status,
  };
}

/** 根据地址 ID 和用户 ID 获取收货地址详情 */
export async function fetchAddress(
  addressId: string,
  userId: string,
): Promise<UserAddressDetail | null> {
  const res = await internalFetch(`${USER_SERVICE_URL}/internal/user/address/detail`, {
    method: 'POST',
    body: JSON.stringify({ addressId, userId }),
  });

  if (!res.ok) {
    log.error('user address fetch failed', { status: res.status });
    return null;
  }

  const json = (await res.json()) as { success: boolean; data: UserAddressDetail | null };
  return json.data ?? null;
}
