/**
 * 分类数据访问层 — categories 表操作
 */
import { eq, isNull, asc } from 'drizzle-orm';
import { db, categories } from '@repo/database';
import type { Category, NewCategory } from '@repo/database';

/** 按 ID 查找 */
export async function findById(id: string): Promise<Category | null> {
  const [row] = await db.select().from(categories).where(eq(categories.id, id));
  return row ?? null;
}

/** 按 slug 查找 */
export async function findBySlug(slug: string): Promise<Category | null> {
  const [row] = await db.select().from(categories).where(eq(categories.slug, slug));
  return row ?? null;
}

/** 查全部分类（service 层组装树） */
export async function findAll(): Promise<Category[]> {
  return db
    .select()
    .from(categories)
    .orderBy(asc(categories.sortOrder), asc(categories.createdAt));
}

/** 按 parentId 查子分类 */
export async function findByParentId(parentId: string | null): Promise<Category[]> {
  if (parentId === null) {
    return db
      .select()
      .from(categories)
      .where(isNull(categories.parentId))
      .orderBy(asc(categories.sortOrder));
  }
  return db
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
