/**
 * 搜索业务逻辑 — 全文搜索 + 缓存
 * PostgreSQL to_tsvector('simple', ...) 兼容中英文基础分词
 */
import * as productRepo from '../repositories/product.repo';
import * as imageRepo from '../repositories/image.repo';
import * as cacheService from './cache.service';
import type { SearchInput, ProductListItem } from '../types';
import type { PaginatedData } from '@repo/shared';

export async function search(params: SearchInput): Promise<PaginatedData<ProductListItem>> {
  // 1. 生成 queryHash
  const queryHash = cacheService.hashQuery(params);

  // 2. 查缓存
  const cached = await cacheService.getCachedSearch(queryHash);
  if (cached) {
    return cached as PaginatedData<ProductListItem>;
  }

  // 3. 查 DB
  const { items: rawItems, total } = await productRepo.search(params);

  // 4. 补充首图
  const allImages = await Promise.all(rawItems.map((p) => imageRepo.findByProductId(p.id)));

  const items: ProductListItem[] = rawItems.map((p, i) => {
    const primaryImg = allImages[i].find((img) => img.isPrimary) ?? allImages[i][0] ?? null;
    return {
      id: p.id,
      title: p.title,
      slug: p.slug,
      brand: p.brand,
      status: p.status,
      minPrice: p.minPrice,
      maxPrice: p.maxPrice,
      totalSales: p.totalSales,
      primaryImage: primaryImg?.url ?? null,
      createdAt: p.createdAt,
    };
  });

  const result: PaginatedData<ProductListItem> = {
    items,
    pagination: {
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages: Math.ceil(total / params.pageSize),
    },
  };

  // 5. 写缓存 (TTL 3min)
  await cacheService.setCachedSearch(queryHash, result);

  return result;
}
