/**
 * Product Service HTTP 客户端
 * 封装对 product-service 内部接口的调用
 * 用于 SKU 查询、库存预扣/释放/确认
 */
import { getConfig, InternalError, internalFetch } from '@repo/shared';
import type { SkuDetail } from '../types';

const config = getConfig();
const PRODUCT_SERVICE_URL = config.services.productUrl;

/** 批量查询 SKU 详情（含商品信息 + 首图） */
export async function fetchSkuBatch(skuIds: string[]): Promise<SkuDetail[]> {
  if (skuIds.length === 0) return [];

  const res = await internalFetch(`${PRODUCT_SERVICE_URL}/internal/product/sku/batch`, {
    method: 'POST',
    body: JSON.stringify({ skuIds }),
  });

  if (!res.ok) {
    throw new InternalError(`product-service /internal/product/sku/batch failed: ${res.status}`);
  }

  const json = (await res.json()) as { success: boolean; data: SkuDetail[] };
  return json.data ?? [];
}

/** 库存预扣 — Redis Lua 原子操作 */
export async function reserveStock(
  items: Array<{ skuId: string; quantity: number }>,
  orderId: string,
): Promise<void> {
  const res = await internalFetch(`${PRODUCT_SERVICE_URL}/internal/stock/reserve`, {
    method: 'POST',
    body: JSON.stringify({ items, orderId }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      meta?: { code?: string; message?: string; details?: unknown };
      message?: string;
    } | null;
    // 向上游透传错误（如 STOCK_INSUFFICIENT）
    const err = new InternalError(
      body?.message ?? `stock reserve failed: ${res.status}`,
    );
    (err as any).statusCode = res.status;
    if (body?.meta) {
      (err as any).errorCode = body.meta.code;
      (err as any).details = body.meta.details;
    }
    throw err;
  }
}

/** 库存释放 — 订单取消/超时释放 */
export async function releaseStock(
  items: Array<{ skuId: string; quantity: number }>,
  orderId: string,
): Promise<void> {
  const res = await internalFetch(`${PRODUCT_SERVICE_URL}/internal/stock/release`, {
    method: 'POST',
    body: JSON.stringify({ items, orderId }),
  });

  if (!res.ok) {
    console.error(`[order-service] stock release failed: ${res.status}, orderId=${orderId}`);
  }
}

/** 库存确认 — 支付成功后 PG 乐观锁 */
export async function confirmStock(
  items: Array<{ skuId: string; quantity: number }>,
  orderId: string,
): Promise<void> {
  const res = await internalFetch(`${PRODUCT_SERVICE_URL}/internal/stock/confirm`, {
    method: 'POST',
    body: JSON.stringify({ items, orderId }),
  });

  if (!res.ok) {
    throw new InternalError(`stock confirm failed: ${res.status}, orderId=${orderId}`);
  }
}
