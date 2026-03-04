/**
 * Product Service HTTP 客户端
 * 封装对 product-service 内部接口的调用
 * 用于获取 SKU 实时数据（价格、库存、状态）
 */
import { getConfig, internalFetch } from '@repo/shared';
import { redis } from '@repo/database';
import type { SkuDetail } from '../types';

const config = getConfig();
const PRODUCT_SERVICE_URL = config.services.productUrl;

/**
 * 批量查询 SKU 详情（含商品信息 + 首图）
 * 调用 POST /internal/product/sku/batch
 */
export async function fetchSkuBatch(skuIds: string[]): Promise<SkuDetail[]> {
  if (skuIds.length === 0) return [];

  const res = await internalFetch(`${PRODUCT_SERVICE_URL}/internal/product/sku/batch`, {
    method: 'POST',
    body: JSON.stringify({ skuIds }),
  });

  if (!res.ok) {
    throw new Error(`product-service /internal/product/sku/batch failed: ${res.status}`);
  }

  const json = await res.json() as { success: boolean; data: SkuDetail[] };
  return json.data ?? [];
}

/**
 * 从 Redis 直接读取 SKU 库存（提示性，不锁定）
 * 比走 HTTP 更快，购物车只需要提示库存状态
 */
export async function fetchSkuStock(skuId: string): Promise<number> {
  const val = await redis.get(`stock:${skuId}`);
  return val ? Number(val) : 0;
}
