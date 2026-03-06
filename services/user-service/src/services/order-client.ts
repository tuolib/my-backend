/**
 * Order Service HTTP 客户端
 * 封装对 order-service 内部接口的调用
 * 用于管理端用户详情中的订单统计
 */
import { getConfig, internalFetch, createLogger } from '@repo/shared';
import type { AdminUserOrderStats } from '../types';

const config = getConfig();
const ORDER_SERVICE_URL = config.services.orderUrl;
const log = createLogger('order-client');

/** 获取用户订单统计 */
export async function fetchUserOrderStats(userId: string): Promise<AdminUserOrderStats> {
  const fallback: AdminUserOrderStats = { totalOrders: 0, totalPaid: 0, totalAmount: '0' };

  try {
    const res = await internalFetch(`${ORDER_SERVICE_URL}/internal/order/user-stats`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });

    if (!res.ok) {
      log.error('order stats fetch failed', { status: res.status, userId });
      return fallback;
    }

    const json = (await res.json()) as {
      success: boolean;
      data: AdminUserOrderStats;
    };
    return json.data ?? fallback;
  } catch (err) {
    log.error('order stats fetch error', { userId, error: String(err) });
    return fallback;
  }
}
