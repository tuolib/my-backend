/**
 * 地址数据访问层 — user_addresses 表操作
 */
import { eq, and, desc, ne, count } from 'drizzle-orm';
import { db, dbRead, userAddresses } from '@repo/database';
import type { UserAddress, NewUserAddress } from '@repo/database';

/** 按用户 ID 查找所有地址（走从库） */
export async function findByUserId(userId: string): Promise<UserAddress[]> {
  return dbRead
    .select()
    .from(userAddresses)
    .where(eq(userAddresses.userId, userId))
    .orderBy(desc(userAddresses.createdAt));
}

/** 按 ID 查找单个地址 */
export async function findById(id: string): Promise<UserAddress | null> {
  const [row] = await db
    .select()
    .from(userAddresses)
    .where(eq(userAddresses.id, id));
  return row ?? null;
}

/** 创建地址 */
export async function create(data: NewUserAddress): Promise<UserAddress> {
  const [row] = await db.insert(userAddresses).values(data).returning();
  return row;
}

/** 更新地址 */
export async function updateById(
  id: string,
  data: Partial<Pick<UserAddress, 'label' | 'recipient' | 'phone' | 'province' | 'city' | 'district' | 'address' | 'postalCode' | 'isDefault'>>
): Promise<UserAddress | null> {
  const [row] = await db
    .update(userAddresses)
    .set(data)
    .where(eq(userAddresses.id, id))
    .returning();
  return row ?? null;
}

/** 删除地址 */
export async function deleteById(id: string): Promise<void> {
  await db.delete(userAddresses).where(eq(userAddresses.id, id));
}

/** 清除该用户的所有默认地址标记 */
export async function clearDefault(userId: string): Promise<void> {
  await db
    .update(userAddresses)
    .set({ isDefault: false })
    .where(and(eq(userAddresses.userId, userId), eq(userAddresses.isDefault, true)));
}

/** 统计用户地址数量（走从库） */
export async function countByUserId(userId: string): Promise<number> {
  const [row] = await dbRead
    .select({ value: count() })
    .from(userAddresses)
    .where(eq(userAddresses.userId, userId));
  return row?.value ?? 0;
}

/** 设置指定地址为默认（不含清除旧默认，需在 service 层先调 clearDefault） */
export async function setDefault(id: string): Promise<void> {
  await db
    .update(userAddresses)
    .set({ isDefault: true })
    .where(eq(userAddresses.id, id));
}

/** 查找用户最新的一条地址（排除指定 ID） */
export async function findLatestByUserId(
  userId: string,
  excludeId: string
): Promise<UserAddress | null> {
  const [row] = await db
    .select()
    .from(userAddresses)
    .where(and(eq(userAddresses.userId, userId), ne(userAddresses.id, excludeId)))
    .orderBy(desc(userAddresses.createdAt))
    .limit(1);
  return row ?? null;
}
