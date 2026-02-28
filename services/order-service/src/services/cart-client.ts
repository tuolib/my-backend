/**
 * Cart Service HTTP 客户端
 * 封装对 cart-service 内部接口的调用
 */
import { getConfig } from '@repo/shared';

const config = getConfig();
const CART_SERVICE_URL = `http://localhost:${config.server.ports.cart}`;

/** 清理购物车中已下单的 SKU（best effort，失败只记日志） */
export async function clearCartItems(
  userId: string,
  skuIds: string[],
): Promise<void> {
  if (skuIds.length === 0) return;

  try {
    const res = await fetch(`${CART_SERVICE_URL}/internal/cart/clear-items`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': config.internal.secret,
      },
      body: JSON.stringify({ userId, skuIds }),
    });

    if (!res.ok) {
      console.warn(`[order-service] cart clear-items failed: ${res.status}, userId=${userId}`);
    }
  } catch (err) {
    // 购物车清理失败不影响订单
    console.warn(`[order-service] cart clear-items error: ${(err as Error).message}`);
  }
}
