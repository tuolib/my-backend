/**
 * 用户数据访问层 — users 表操作
 */
import { eq, inArray, isNull, and, ilike, or, desc, count } from 'drizzle-orm';
import { db, dbRead, users } from '@repo/database';
import type { User, NewUser } from '@repo/database';

/** 按邮箱查找（排除软删除） */
export async function findByEmail(email: string): Promise<User | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)));
  return row ?? null;
}

/** 按 ID 查找（排除软删除） */
export async function findById(id: string): Promise<User | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt)));
  return row ?? null;
}

/** 批量按 ID 查找（内部服务间调用，走从库） */
export async function findByIds(ids: string[]): Promise<User[]> {
  if (ids.length === 0) return [];
  return dbRead
    .select()
    .from(users)
    .where(and(inArray(users.id, ids), isNull(users.deletedAt)));
}

/** 创建用户 */
export async function create(data: NewUser): Promise<User> {
  const [row] = await db.insert(users).values(data).returning();
  return row;
}

/** 按 ID 更新用户 */
export async function updateById(
  id: string,
  data: Partial<Pick<User, 'nickname' | 'avatarUrl' | 'phone' | 'status'>>
): Promise<User | null> {
  const [row] = await db
    .update(users)
    .set(data)
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .returning();
  return row ?? null;
}

/** 管理端分页查询用户列表（含关键词搜索） */
export async function findAll(params: {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
}): Promise<{ items: User[]; total: number }> {
  const { page, pageSize, keyword, status } = params;
  const offset = (page - 1) * pageSize;

  const conditions = [isNull(users.deletedAt)];
  if (status) {
    conditions.push(eq(users.status, status));
  }
  if (keyword) {
    const pattern = `%${keyword}%`;
    conditions.push(or(ilike(users.email, pattern), ilike(users.nickname, pattern))!);
  }

  const where = and(...conditions);

  const [items, [totalRow]] = await Promise.all([
    dbRead
      .select()
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(pageSize)
      .offset(offset),
    dbRead
      .select({ value: count() })
      .from(users)
      .where(where),
  ]);

  return { items, total: totalRow?.value ?? 0 };
}

/** 更新最后登录时间 */
export async function updateLastLogin(id: string): Promise<void> {
  await db
    .update(users)
    .set({ lastLogin: new Date() })
    .where(eq(users.id, id));
}
