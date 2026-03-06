/**
 * 商品数据访问层 — products 表操作
 * 支持列表查询（分页/排序/筛选）、全文搜索、CRUD
 */
import { eq, and, isNull, inArray, sql, desc, asc, ilike, SQL } from 'drizzle-orm';
import {
  db,
  products,
  productCategories,
  skus,
  categories,
} from '@repo/database';
import type { Product, NewProduct } from '@repo/database';

/**
 * 递归收集分类及其所有后代分类 ID
 * 用于父分类筛选时包含子分类下的商品
 */
async function collectCategoryIds(categoryId: string): Promise<string[]> {
  const result = [categoryId];
  const children = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.parentId, categoryId));
  for (const child of children) {
    const descendantIds = await collectCategoryIds(child.id);
    result.push(...descendantIds);
  }
  return result;
}

/** 按 ID 查找（排除软删除） */
export async function findById(id: string): Promise<Product | null> {
  const [row] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, id), isNull(products.deletedAt)));
  return row ?? null;
}

/** 按 slug 查找（排除软删除） */
export async function findBySlug(slug: string): Promise<Product | null> {
  const [row] = await db
    .select()
    .from(products)
    .where(and(eq(products.slug, slug), isNull(products.deletedAt)));
  return row ?? null;
}

/** 分页列表查询 */
export async function findList(params: {
  page: number;
  pageSize: number;
  sort: string;
  order: 'asc' | 'desc';
  filters?: { status?: string; categoryId?: string; brand?: string };
}): Promise<{ items: Product[]; total: number }> {
  const { page, pageSize, sort, order, filters } = params;
  const offset = (page - 1) * pageSize;

  // 构建 WHERE 条件（公开列表强制只显示上架商品）
  const conditions: SQL[] = [
    isNull(products.deletedAt),
    eq(products.status, 'active'),
  ];

  if (filters?.brand) {
    conditions.push(eq(products.brand, filters.brand));
  }

  // 分类筛选：用子查询代替 JOIN，避免 DISTINCT ON 破坏排序
  if (filters?.categoryId) {
    const categoryIds = await collectCategoryIds(filters.categoryId);
    conditions.push(
      inArray(
        products.id,
        db.select({ id: productCategories.productId })
          .from(productCategories)
          .where(inArray(productCategories.categoryId, categoryIds)),
      ),
    );
  }

  // 构建排序
  const orderFn = order === 'asc' ? asc : desc;
  let orderBy;
  switch (sort) {
    case 'price':
      orderBy = orderFn(products.minPrice);
      break;
    case 'sales':
      orderBy = orderFn(products.totalSales);
      break;
    default:
      orderBy = orderFn(products.createdAt);
  }

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(products)
    .where(and(...conditions));
  const total = Number(countResult.count);

  const items = await db
    .select()
    .from(products)
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(pageSize)
    .offset(offset);

  return { items, total };
}

/**
 * 全文搜索
 * FTS (simple) 用于英文/空格分词，ILIKE 兜底中文子串匹配，
 * 同时搜索关联的分类名称（如搜"手机"匹配手机分类下的所有商品）
 */
export async function search(params: {
  keyword: string;
  categoryId?: string;
  priceMin?: number;
  priceMax?: number;
  sort: string;
  page: number;
  pageSize: number;
}): Promise<{ items: Product[]; total: number }> {
  const { keyword, categoryId, priceMin, priceMax, sort, page, pageSize } = params;
  const offset = (page - 1) * pageSize;
  const likePattern = `%${keyword}%`;

  // FTS + ILIKE 兜底 + 分类名匹配
  const textMatch = sql`(
    to_tsvector('simple', ${products.title} || ' ' || coalesce(${products.description}, '') || ' ' || coalesce(${products.brand}, ''))
      @@ plainto_tsquery('simple', ${keyword})
    OR ${products.title} ILIKE ${likePattern}
    OR coalesce(${products.description}, '') ILIKE ${likePattern}
    OR coalesce(${products.brand}, '') ILIKE ${likePattern}
    OR ${categories.name} ILIKE ${likePattern}
  )`;

  const conditions: SQL[] = [
    isNull(products.deletedAt),
    eq(products.status, 'active'),
    textMatch,
  ];

  if (priceMin !== undefined) {
    conditions.push(sql`CAST(${products.minPrice} AS numeric) >= ${priceMin}`);
  }
  if (priceMax !== undefined) {
    conditions.push(sql`CAST(${products.maxPrice} AS numeric) <= ${priceMax}`);
  }
  if (categoryId) {
    const allCategoryIds = await collectCategoryIds(categoryId);
    conditions.push(inArray(productCategories.categoryId, allCategoryIds));
  }

  // 排序
  let orderBy;
  switch (sort) {
    case 'price_asc':
      orderBy = asc(products.minPrice);
      break;
    case 'price_desc':
      orderBy = desc(products.maxPrice);
      break;
    case 'sales':
      orderBy = desc(products.totalSales);
      break;
    case 'newest':
      orderBy = desc(products.createdAt);
      break;
    default:
      // relevance — FTS 排名优先，ILIKE 匹配次之
      orderBy = sql`(
        ts_rank(
          to_tsvector('simple', ${products.title} || ' ' || coalesce(${products.description}, '') || ' ' || coalesce(${products.brand}, '')),
          plainto_tsquery('simple', ${keyword})
        )
        + CASE WHEN ${products.title} ILIKE ${likePattern} THEN 0.5 ELSE 0 END
        + CASE WHEN ${categories.name} ILIKE ${likePattern} THEN 0.3 ELSE 0 END
      ) DESC`;
  }

  // 始终 LEFT JOIN 分类表以支持分类名搜索
  const [countResult] = await db
    .select({ count: sql<number>`count(DISTINCT ${products.id})` })
    .from(products)
    .leftJoin(productCategories, eq(products.id, productCategories.productId))
    .leftJoin(categories, eq(productCategories.categoryId, categories.id))
    .where(and(...conditions));
  const total = Number(countResult.count);

  const items = await db
    .selectDistinctOn([products.id])
    .from(products)
    .leftJoin(productCategories, eq(products.id, productCategories.productId))
    .leftJoin(categories, eq(productCategories.categoryId, categories.id))
    .where(and(...conditions))
    .orderBy(products.id, orderBy)
    .limit(pageSize)
    .offset(offset)
    .then((rows) => rows.map((r) => r.products));

  return { items, total };
}

/** Admin 分页列表查询（含关键词搜索，不限状态） */
export async function findAdminList(params: {
  page: number;
  pageSize: number;
  sort: string;
  order: 'asc' | 'desc';
  keyword?: string;
  filters?: { status?: string; categoryId?: string; brand?: string };
}): Promise<{ items: Product[]; total: number }> {
  const { page, pageSize, sort, order, keyword, filters } = params;
  const offset = (page - 1) * pageSize;

  // Admin 列表不排除软删除 —— 但仍可通过 status=archived 筛选
  const conditions: SQL[] = [isNull(products.deletedAt)];

  if (filters?.status) {
    conditions.push(eq(products.status, filters.status));
  }
  if (filters?.brand) {
    conditions.push(eq(products.brand, filters.brand));
  }
  if (keyword) {
    const likePattern = `%${keyword}%`;
    conditions.push(ilike(products.title, likePattern));
  }

  // 分类筛选：用子查询代替 JOIN，避免 DISTINCT ON 破坏排序
  if (filters?.categoryId) {
    const categoryIds = await collectCategoryIds(filters.categoryId);
    conditions.push(
      inArray(
        products.id,
        db.select({ id: productCategories.productId })
          .from(productCategories)
          .where(inArray(productCategories.categoryId, categoryIds)),
      ),
    );
  }

  const orderFn = order === 'asc' ? asc : desc;
  let orderBy;
  switch (sort) {
    case 'price':
      orderBy = orderFn(products.minPrice);
      break;
    case 'sales':
      orderBy = orderFn(products.totalSales);
      break;
    default:
      orderBy = orderFn(products.createdAt);
  }

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(products)
    .where(and(...conditions));
  const total = Number(countResult.count);

  const items = await db
    .select()
    .from(products)
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(pageSize)
    .offset(offset);

  return { items, total };
}

/** 创建商品 */
export async function create(data: NewProduct): Promise<Product> {
  const [row] = await db.insert(products).values(data).returning();
  return row;
}

/** 按 ID 更新商品 */
export async function updateById(
  id: string,
  data: Partial<Pick<Product, 'title' | 'slug' | 'description' | 'brand' | 'status' | 'attributes' | 'minPrice' | 'maxPrice'>>,
): Promise<Product | null> {
  const [row] = await db
    .update(products)
    .set(data)
    .where(and(eq(products.id, id), isNull(products.deletedAt)))
    .returning();
  return row ?? null;
}

/** 软删除商品 */
export async function softDelete(id: string): Promise<void> {
  await db
    .update(products)
    .set({ deletedAt: new Date(), status: 'archived' })
    .where(and(eq(products.id, id), isNull(products.deletedAt)));
}

/** 更新价格区间（根据 SKU 计算） */
export async function updatePriceRange(productId: string): Promise<void> {
  const result = await db
    .select({
      minPrice: sql<string>`MIN(CAST(${skus.price} AS numeric))`,
      maxPrice: sql<string>`MAX(CAST(${skus.price} AS numeric))`,
    })
    .from(skus)
    .where(and(eq(skus.productId, productId), eq(skus.status, 'active')));

  const { minPrice, maxPrice } = result[0];
  await db
    .update(products)
    .set({
      minPrice: minPrice?.toString() ?? null,
      maxPrice: maxPrice?.toString() ?? null,
    })
    .where(eq(products.id, productId));
}

/** 增加销量 */
export async function updateSalesCount(productId: string, increment: number): Promise<void> {
  await db
    .update(products)
    .set({ totalSales: sql`${products.totalSales} + ${increment}` })
    .where(eq(products.id, productId));
}
