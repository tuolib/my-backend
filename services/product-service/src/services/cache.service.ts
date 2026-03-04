/**
 * 缓存策略封装 — Cache-Aside + 穿透防护 + 击穿防护
 * Redis Key 规范: product:{resource}:{id}
 */
import { redis } from '@repo/database';
import { sha256, createLogger } from '@repo/shared';
import type { ProductDetail, CategoryNode } from '../types';

const log = createLogger('cache');
const EMPTY_MARKER = '{"empty":true}';

// ── 商品详情缓存 ──

export async function getCachedProductDetail(productId: string): Promise<ProductDetail | null | 'empty'> {
  const key = `product:detail:${productId}`;
  const cached = await redis.get(key);
  if (cached === null) {
    log.debug('cache miss', { key });
    return null;
  }
  if (cached === EMPTY_MARKER) {
    log.debug('cache hit empty', { key });
    return 'empty';
  }
  log.debug('cache hit', { key });
  return JSON.parse(cached) as ProductDetail;
}

export async function setCachedProductDetail(productId: string, data: ProductDetail | null): Promise<void> {
  const key = `product:detail:${productId}`;
  if (data === null) {
    // 穿透防护：缓存空值标记，TTL 60s
    await redis.set(key, EMPTY_MARKER, 'EX', 60);
    return;
  }
  // TTL = 600s(10min) + 随机 0~120s 抖动防雪崩
  const ttl = 600 + Math.floor(Math.random() * 120);
  await redis.set(key, JSON.stringify(data), 'EX', ttl);
}

export async function invalidateProductDetail(productId: string): Promise<void> {
  await redis.del(`product:detail:${productId}`);
}

// ── 分类树缓存 ──

export async function getCachedCategoryTree(): Promise<CategoryNode[] | null> {
  const cached = await redis.get('product:category:tree');
  if (cached === null) return null;
  return JSON.parse(cached) as CategoryNode[];
}

export async function setCachedCategoryTree(tree: CategoryNode[]): Promise<void> {
  await redis.set('product:category:tree', JSON.stringify(tree), 'EX', 3600);
}

export async function invalidateCategoryTree(): Promise<void> {
  await redis.del('product:category:tree');
}

// ── 搜索结果缓存 ──

export async function getCachedSearch(queryHash: string): Promise<unknown | null> {
  const cached = await redis.get(`product:search:${queryHash}`);
  if (cached === null) return null;
  return JSON.parse(cached);
}

export async function setCachedSearch(queryHash: string, data: unknown): Promise<void> {
  await redis.set(`product:search:${queryHash}`, JSON.stringify(data), 'EX', 180);
}

// ── 工具 ──

export function hashQuery(params: object): string {
  return sha256(JSON.stringify(params)).slice(0, 16);
}
