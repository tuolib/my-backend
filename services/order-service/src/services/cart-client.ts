/**
 * Cart Service HTTP 客户端
 * 封装对 cart-service 内部接口的调用
 */
import { getConfig, internalFetch, createLogger } from '@repo/shared';

const config = getConfig();
const CART_SERVICE_URL = config.services.cartUrl;
const log = createLogger('cart-client');

/** 清理购物车中已下单的 SKU（best effort，失败只记日志） */
export async function clearCartItems(
  userId: string,
  skuIds: string[],
): Promise<void> {
  if (skuIds.length === 0) return;

  try {
    const res = await internalFetch(`${CART_SERVICE_URL}/internal/cart/clear-items`, {
      method: 'POST',
      body: JSON.stringify({ userId, skuIds }),
    });

    if (!res.ok) {
      log.warn('cart clear-items failed', { status: res.status, userId });
    }
  } catch (err) {
    // 购物车清理失败不影响订单
    log.warn('cart clear-items error', { error: (err as Error).message });
  }
}
