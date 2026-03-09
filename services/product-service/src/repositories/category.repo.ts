/**
 * 分类数据访问层 — categories 表操作
 */
import { eq, isNull, asc, ilike, and, count } from 'drizzle-orm';
import { db, dbRead, categories, productCategories } from '@repo/database';
import type { Category, NewCategory } from '@repo/database';
import type { AdminCategoryListInput } from '../types';

/** 按 ID 查找（走从库） */
export async function findById(id: string): Promise<Category | null> {
  const [row] = await dbRead.select().from(categories).where(eq(categories.id, id));
  return row ?? null;
}

/** 按 slug 查找（走从库） */
export async function findBySlug(slug: string): Promise<Category | null> {
  const [row] = await dbRead.select().from(categories).where(eq(categories.slug, slug));
  return row ?? null;
}

/** 查全部分类（service 层组装树，走从库） */
export async function findAll(): Promise<Category[]> {
  return dbRead
    .select()
    .from(categories)
    .orderBy(asc(categories.sortOrder), asc(categories.createdAt));
}

/** 按 parentId 查子分类（走从库） */
export async function findByParentId(parentId: string | null): Promise<Category[]> {
  if (parentId === null) {
    return dbRead
      .select()
      .from(categories)
      .where(isNull(categories.parentId))
      .orderBy(asc(categories.sortOrder));
  }
  return dbRead
    .select()
    .from(categories)
    .where(eq(categories.parentId, parentId))
    .orderBy(asc(categories.sortOrder));
}

/** 创建分类 */
export async function create(data: NewCategory): Promise<Category> {
  const [row] = await db.insert(categories).values(data).returning();
  return row;
}

/** Admin：分类列表（分页、筛选） */
export async function findAdminList(params: AdminCategoryListInput): Promise<{ items: Category[]; total: number }> {
  const conditions = [];

  if (params.keyword) {
    conditions.push(ilike(categories.name, `%${params.keyword}%`));
  }
  if (params.isActive !== undefined) {
    conditions.push(eq(categories.isActive, params.isActive));
  }
  if (params.parentId !== undefined) {
    if (params.parentId === null) {
      conditions.push(isNull(categories.parentId));
    } else {
      conditions.push(eq(categories.parentId, params.parentId));
    }
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const offset = (params.page - 1) * params.pageSize;

  const [items, [{ value: total }]] = await Promise.all([
    dbRead
      .select()
      .from(categories)
      .where(where)
      .orderBy(asc(categories.sortOrder), asc(categories.createdAt))
      .limit(params.pageSize)
      .offset(offset),
    dbRead
      .select({ value: count() })
      .from(categories)
      .where(where),
  ]);

  return { items, total };
}

/** 查该分类关联的商品数量（走从库） */
export async function countProductsByCategoryId(categoryId: string): Promise<number> {
  const [row] = await dbRead
    .select({ value: count() })
    .from(productCategories)
    .where(eq(productCategories.categoryId, categoryId));
  return row.value;
}

/** 查子分类数量（走从库） */
export async function countChildren(parentId: string): Promise<number> {
  const [row] = await dbRead
    .select({ value: count() })
    .from(categories)
    .where(eq(categories.parentId, parentId));
  return row.value;
}

/** 硬删除分类 */
export async function deleteById(id: string): Promise<void> {
  await db.delete(categories).where(eq(categories.id, id));
}

/** 按 ID 更新分类 */
export async function updateById(
  id: string,
  data: Partial<Pick<Category, 'name' | 'slug' | 'parentId' | 'iconUrl' | 'sortOrder' | 'isActive'>>,
): Promise<Category | null> {
  const [row] = await db
    .update(categories)
    .set(data)
    .where(eq(categories.id, id))
    .returning();
  return row ?? null;
}
