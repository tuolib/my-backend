/**
 * User Service HTTP 客户端
 * 封装对 user-service 内部接口的调用
 * 用于获取收货地址信息
 */
import { getConfig } from '@repo/shared';
import type { UserAddressDetail } from '../types';

const config = getConfig();
const USER_SERVICE_URL = `http://localhost:${config.server.ports.user}`;

/** 根据地址 ID 和用户 ID 获取收货地址详情 */
export async function fetchAddress(
  addressId: string,
  userId: string,
): Promise<UserAddressDetail | null> {
  const res = await fetch(`${USER_SERVICE_URL}/internal/user/address/detail`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-token': config.internal.secret,
    },
    body: JSON.stringify({ addressId, userId }),
  });

  if (!res.ok) {
    console.error(`[order-service] user address fetch failed: ${res.status}`);
    return null;
  }

  const json = (await res.json()) as { success: boolean; data: UserAddressDetail | null };
  return json.data ?? null;
}
