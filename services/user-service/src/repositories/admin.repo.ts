/**
 * 管理员数据访问层 — admins 表操作
 */
import { eq, and, like, sql, desc } from 'drizzle-orm';
import { db, admins } from '@repo/database';
import type { Admin, NewAdmin } from '@repo/database';

/** 按用户名查找 */
export async function findByUsername(username: string): Promise<Admin | null> {
  const [row] = await db
    .select()
    .from(admins)
    .where(eq(admins.username, username));
  return row ?? null;
}

/** 按 ID 查找 */
export async function findById(id: string): Promise<Admin | null> {
  const [row] = await db
    .select()
    .from(admins)
    .where(eq(admins.id, id));
  return row ?? null;
}

/** 创建管理员 */
export async function create(data: NewAdmin): Promise<Admin> {
  const [row] = await db.insert(admins).values(data).returning();
  return row;
}

/** 更新最后登录时间 & 重置失败计数 */
export async function updateLoginSuccess(id: string): Promise<void> {
  await db
    .update(admins)
    .set({ lastLoginAt: new Date(), loginFailCount: 0, lockedUntil: null })
    .where(eq(admins.id, id));
}

/** 增加登录失败计数，达到上限时锁定 */
export async function incrementLoginFail(id: string, currentCount: number): Promise<void> {
  const MAX_FAIL = 5;
  const LOCK_MINUTES = 30;

  const updates: Partial<Admin> = {
    loginFailCount: currentCount + 1,
  };

  if (currentCount + 1 >= MAX_FAIL) {
    updates.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
  }

  await db.update(admins).set(updates).where(eq(admins.id, id));
}

/** 更新密码 & 清除首次改密标记 */
export async function updatePassword(id: string, hashedPassword: string): Promise<void> {
  await db
    .update(admins)
    .set({ password: hashedPassword, mustChangePassword: false })
    .where(eq(admins.id, id));
}

/** 管理员列表（分页 + 关键词搜索） */
export async function list(params: {
  page: number;
  pageSize: number;
  keyword?: string;
}): Promise<{ items: Admin[]; total: number }> {
  const { page, pageSize, keyword } = params;
  const conditions = keyword
    ? [like(admins.username, `%${keyword}%`)]
    : [];

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(admins)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(admins.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(admins)
      .where(conditions.length ? and(...conditions) : undefined),
  ]);

  return { items, total: countResult[0].count };
}

/** 更新管理员信息 */
export async function updateById(
  id: string,
  data: Partial<Pick<Admin, 'realName' | 'phone' | 'email' | 'role' | 'status'>>,
): Promise<Admin | null> {
  const [row] = await db
    .update(admins)
    .set(data)
    .where(eq(admins.id, id))
    .returning();
  return row ?? null;
}

/** 重置密码（设为临时密码 + 标记首次改密） */
export async function resetPassword(id: string, hashedPassword: string): Promise<void> {
  await db
    .update(admins)
    .set({
      password: hashedPassword,
      mustChangePassword: true,
      loginFailCount: 0,
      lockedUntil: null,
    })
    .where(eq(admins.id, id));
}
